import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { DotAiRuntime } from '../runtime.js';
import type { Providers } from '../engine.js';
import { loadExtensions } from '../extension-loader.js';
import { ExtensionRunner, EventBus } from '../extension-runner.js';

const fixtureDir = join(import.meta.dirname, 'fixtures', 'extensions');

function createMockProviders(): Providers {
  return {
    memory: {
      search: vi.fn().mockResolvedValue([
        { content: 'Previous decision about auth', type: 'decision', source: 'test', date: '2026-03-01' },
      ]),
      store: vi.fn().mockResolvedValue(undefined),
      describe: vi.fn().mockReturnValue('Test memory (SQLite)'),
    },
    skills: {
      list: vi.fn().mockResolvedValue([
        { name: 'security', description: 'Security rules', labels: ['security', 'auth'] },
      ]),
      match: vi.fn().mockResolvedValue([
        { name: 'security', description: 'Security rules', labels: ['security'], content: '## Security Rules\n\nAlways validate inputs.' },
      ]),
      load: vi.fn().mockResolvedValue('## Security Rules\n\nAlways validate inputs.'),
    },
    identity: {
      load: vi.fn().mockResolvedValue([
        { type: 'agents', content: '# Kiwi Agent\n\nYou are Kiwi, a workspace assistant.', source: 'file', priority: 100 },
      ]),
    },
    routing: {
      route: vi.fn().mockResolvedValue({ model: 'sonnet', reason: 'standard task' }),
    },
    tasks: {
      list: vi.fn().mockResolvedValue([
        { id: 'task-1', text: 'Fix auth bug', status: 'in_progress', project: 'backend' },
      ]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'task-2', text: 'New task', status: 'pending' }),
      update: vi.fn().mockResolvedValue({ id: 'task-1', text: 'Fix auth bug', status: 'done' }),
    },
    tools: {
      list: vi.fn().mockResolvedValue([]),
      match: vi.fn().mockResolvedValue([]),
      load: vi.fn().mockResolvedValue(null),
    },
  };
}

describe('E2E: Simulate Claude Code Full Prompt Flow', () => {
  /**
   * Simulates what happens in adapter-claude/hook.ts:
   * 1. SessionStart: Boot runtime -> session_start fired
   * 2. UserPromptSubmit: processPrompt(prompt) -> formatted context
   * 3. PreToolUse: fireToolCall({ tool, input }) -> allow/block
   * 4. Stop: learn(response) -> agent_end fired
   */
  it('full session lifecycle with extensions', async () => {
    const providers = createMockProviders();
    const runtime = new DotAiRuntime({
      workspaceRoot: '/tmp/nonexistent',
      providers,
    });

    // === Step 1: SessionStart (boot) ===
    await runtime.boot();
    expect(runtime.isBooted).toBe(true);
    expect(runtime.runner).not.toBeNull();

    const diag = runtime.diagnostics;
    expect(diag.providerStatus['memory']).toBe(true);
    expect(diag.providerStatus['skills']).toBe(true);
    expect(diag.capabilityCount).toBeGreaterThan(0);

    // === Step 2: UserPromptSubmit ===
    const { formatted, enriched, capabilities } = await runtime.processPrompt(
      'fix the auth security bug in the backend',
    );

    // Should have formatted output
    expect(formatted).toBeTruthy();
    expect(formatted.length).toBeGreaterThan(0);

    // Enriched context should have data from providers
    expect(enriched.labels.length).toBeGreaterThan(0);
    expect(enriched.memories.length).toBeGreaterThan(0);
    expect(enriched.identities.length).toBeGreaterThan(0);

    // Capabilities should include provider tools
    const capNames = capabilities.map(c => c.name);
    expect(capNames).toContain('memory_recall');
    expect(capNames).toContain('memory_store');
    expect(capNames).toContain('task_list');

    // === Step 3: PreToolUse - normal write (should allow) ===
    const allowResult = await runtime.fireToolCall({
      tool: 'Write',
      input: { file_path: '/project/src/auth.ts' },
    });
    expect(allowResult).toBeNull(); // No block (no extensions loaded)

    // === Step 4: Stop (learn) ===
    // Response must be >= 100 chars and NOT start with a conversational prefix
    const substantiveResponse = 'The authentication system was refactored to use JWT with refresh tokens. Key changes: 1) Added token rotation 2) Updated middleware 3) Added rate limiting to prevent abuse';
    await runtime.learn(substantiveResponse);
    expect(providers.memory!.store).toHaveBeenCalledOnce();

    // === Shutdown ===
    await runtime.shutdown();
  });

  it('formatted output contains expected sections', async () => {
    const providers = createMockProviders();
    const runtime = new DotAiRuntime({
      workspaceRoot: '/tmp/nonexistent',
      providers,
    });
    await runtime.boot();

    const { formatted } = await runtime.processPrompt('fix security issue');

    // Should contain identity content (not skipped)
    expect(formatted).toContain('Kiwi Agent');

    // Should contain memory section
    expect(formatted).toContain('Relevant Memory');
    expect(formatted).toContain('Previous decision about auth');

    // Should contain tasks section
    expect(formatted).toContain('Current Tasks');
    expect(formatted).toContain('Fix auth bug');

    // Should contain skills section
    expect(formatted).toContain('Active Skills');
    expect(formatted).toContain('Security Rules');

    // Should contain routing hint
    expect(formatted).toContain('sonnet');
  });

  it('capabilities can be executed', async () => {
    const providers = createMockProviders();
    const runtime = new DotAiRuntime({
      workspaceRoot: '/tmp/nonexistent',
      providers,
    });
    await runtime.boot();

    // Execute memory_recall capability
    const recallCap = runtime.capabilities.find(c => c.name === 'memory_recall');
    expect(recallCap).toBeDefined();
    const result = await recallCap!.execute({ query: 'auth decisions' });
    expect(result.text).toContain('Previous decision about auth');

    // Execute task_list capability
    const taskCap = runtime.capabilities.find(c => c.name === 'task_list');
    expect(taskCap).toBeDefined();
    const taskResult = await taskCap!.execute({});
    expect(taskResult.text).toContain('Fix auth bug');
  });
});

describe('E2E: Simulate OpenClaw Full Prompt Flow', () => {
  /**
   * Simulates what happens in adapter-openclaw/index.ts:
   * 1. before_agent_start: boot + processPrompt(prompt) -> prependContext
   * 2. Tool execution: capabilities.execute()
   * 3. after_agent_end: learn(response)
   */
  it('full agent session with tool execution', async () => {
    const providers = createMockProviders();
    const runtime = new DotAiRuntime({
      workspaceRoot: '/tmp/nonexistent',
      providers,
      skipIdentities: true, // OpenClaw adapter skips identities
    });

    // === Step 1: before_agent_start ===
    await runtime.boot();

    const { formatted } = await runtime.processPrompt(
      'list all tasks and fix the security issue',
    );

    // OpenClaw prepends this to agent context
    expect(formatted).toBeTruthy();
    // With skipIdentities, should NOT contain identity content
    expect(formatted).not.toContain('Kiwi Agent');
    // But should have memory
    expect(formatted).toContain('Relevant Memory');

    // === Step 2: Tool execution (simulating agent calling tools) ===
    // Agent calls task_list
    const taskListCap = runtime.capabilities.find(c => c.name === 'task_list');
    expect(taskListCap).toBeDefined();
    const tasks = await taskListCap!.execute({ status: 'in_progress' });
    expect(tasks.text).toContain('Fix auth bug');

    // Agent calls memory_store
    const storeCapability = runtime.capabilities.find(c => c.name === 'memory_store');
    expect(storeCapability).toBeDefined();
    const storeResult = await storeCapability!.execute({
      text: 'Fixed auth bug by adding JWT validation',
      type: 'decision',
    });
    expect(storeResult.text).toContain('Memory stored');
    expect(providers.memory!.store).toHaveBeenCalled();

    // === Step 3: after_agent_end ===
    // Response must be >= 100 chars and NOT start with a conversational prefix
    const response = 'Refactored the authentication module to use proper JWT validation with token rotation. Added input sanitization across all API endpoints for enhanced security.';
    await runtime.learn(response);
    // learn() stores in memory (the response is long enough and not conversational)
  });

  it('multiple prompts in same session reuse boot cache', async () => {
    const providers = createMockProviders();
    const runtime = new DotAiRuntime({
      workspaceRoot: '/tmp/nonexistent',
      providers,
    });
    await runtime.boot();

    // First prompt
    const r1 = await runtime.processPrompt('fix memory issue');
    expect(r1.formatted).toBeTruthy();

    // Second prompt in same session
    const r2 = await runtime.processPrompt('now fix the routing');
    expect(r2.formatted).toBeTruthy();

    // identity.load should only be called once (at boot)
    expect(providers.identity!.load).toHaveBeenCalledOnce();

    // But memory.search should be called for each prompt
    expect(providers.memory!.search).toHaveBeenCalledTimes(2);
  });
});

describe('E2E: Extensions with Full Runtime', () => {
  /**
   * Test with REAL extensions loaded from fixtures.
   * Simulates a Claude Code session where extensions are active.
   */
  it('security-gate extension blocks .env writes through runner', async () => {
    // Load real extensions using the full API signature
    const eventBus = new EventBus();
    const extensions = await loadExtensions(
      [join(fixtureDir, 'security-gate.js')],
      undefined, // no providers needed for security-gate
      eventBus,
    );
    const runner = new ExtensionRunner(extensions);

    // .env file should be blocked
    const blocked = await runner.fireUntilBlocked('tool_call', {
      tool: 'Write',
      input: { file_path: '/project/.env' },
    });
    expect(blocked).not.toBeNull();
    expect(blocked!.decision).toBe('block');
    expect(blocked!.reason).toContain('.env');

    // Normal file should be allowed
    const allowed = await runner.fireUntilBlocked('tool_call', {
      tool: 'Write',
      input: { file_path: '/project/src/app.ts' },
    });
    expect(allowed).toBeNull();
  });

  it('security-gate extension blocks dangerous bash commands', async () => {
    const eventBus = new EventBus();
    const extensions = await loadExtensions(
      [join(fixtureDir, 'security-gate.js')],
      undefined,
      eventBus,
    );
    const runner = new ExtensionRunner(extensions);

    // Dangerous rm -rf / should be blocked
    const blocked = await runner.fireUntilBlocked('tool_call', {
      tool: 'Bash',
      input: { command: 'rm -rf /' },
    });
    expect(blocked).not.toBeNull();
    expect(blocked!.decision).toBe('block');

    // Normal bash command should be allowed
    const allowed = await runner.fireUntilBlocked('tool_call', {
      tool: 'Bash',
      input: { command: 'ls -la' },
    });
    expect(allowed).toBeNull();
  });

  it('smart-context extension injects context through runner', async () => {
    const eventBus = new EventBus();
    const extensions = await loadExtensions(
      [join(fixtureDir, 'smart-context.js')],
      undefined,
      eventBus,
    );
    const runner = new ExtensionRunner(extensions);

    // Prompt with 'memory' label should trigger context injection
    const results = await runner.fire<{ inject?: string }>('context_inject', {
      prompt: 'fix memory leak',
      labels: [{ name: 'memory', source: 'extract' }],
    });

    expect(results.length).toBeGreaterThan(0);
    const injected = results.find(r => r.inject);
    expect(injected).toBeDefined();
    expect(injected!.inject).toContain('memory_recall');
  });

  it('smart-context extension does not inject when no matching labels', async () => {
    const eventBus = new EventBus();
    const extensions = await loadExtensions(
      [join(fixtureDir, 'smart-context.js')],
      undefined,
      eventBus,
    );
    const runner = new ExtensionRunner(extensions);

    // Prompt without 'memory' label should not inject
    const results = await runner.fire<{ inject?: string }>('context_inject', {
      prompt: 'fix typescript bug',
      labels: [{ name: 'typescript', source: 'extract' }],
    });

    // Handler returns undefined when no match, so results should be empty
    expect(results.filter(r => r.inject)).toHaveLength(0);
  });

  it('session-analytics extension tracks calls and provides stats tool', async () => {
    const eventBus = new EventBus();
    const extensions = await loadExtensions(
      [join(fixtureDir, 'session-analytics.js')],
      undefined,
      eventBus,
    );
    const runner = new ExtensionRunner(extensions);

    // Simulate tool calls
    await runner.fire('tool_call', { tool: 'Read', input: {} });
    await runner.fire('tool_call', { tool: 'Read', input: {} });
    await runner.fire('tool_call', { tool: 'Write', input: {} });
    await runner.fire('tool_call', { tool: 'Bash', input: {} });

    // Get stats tool
    const statsTool = runner.tools.find(t => t.name === 'session_stats');
    expect(statsTool).toBeDefined();

    const stats = await statsTool!.execute({});
    expect(stats.content).toContain('Total calls: 4');
    expect(stats.content).toContain('Read: 2');
    expect(stats.content).toContain('Write: 1');
    expect(stats.content).toContain('Bash: 1');
  });

  it('multiple extensions compose correctly', async () => {
    const eventBus = new EventBus();
    const extensions = await loadExtensions(
      [
        join(fixtureDir, 'security-gate.js'),
        join(fixtureDir, 'session-analytics.js'),
      ],
      undefined,
      eventBus,
    );
    const runner = new ExtensionRunner(extensions);

    // A blocked tool call should still be tracked by analytics
    const blocked = await runner.fireUntilBlocked('tool_call', {
      tool: 'Write',
      input: { file_path: '/project/.env' },
    });
    expect(blocked).not.toBeNull();
    expect(blocked!.decision).toBe('block');

    // fireUntilBlocked stops at first block, so analytics may or may not
    // have seen it depending on extension order. But fire() processes all.
    // Let's fire a normal tool call to verify analytics works alongside security
    await runner.fire('tool_call', { tool: 'Read', input: {} });

    const statsTool = runner.tools.find(t => t.name === 'session_stats');
    expect(statsTool).toBeDefined();
    const stats = await statsTool!.execute({});
    expect(stats.content).toContain('Total calls:');
  });

  it('extension tools appear as runtime capabilities', async () => {
    const providers = createMockProviders();

    // We can't easily wire fixture extensions through the runtime's auto-discovery
    // (it looks in .ai/extensions/ directories), so we verify the integration path
    // by manually loading extensions and checking tools are built into capabilities.
    const eventBus = new EventBus();
    const extensions = await loadExtensions(
      [join(fixtureDir, 'session-analytics.js')],
      providers,
      eventBus,
    );
    const runner = new ExtensionRunner(extensions);

    // Extension tools should be available on the runner
    expect(runner.tools.length).toBe(1);
    expect(runner.tools[0].name).toBe('session_stats');

    // Diagnostics should reflect loaded extension
    expect(runner.diagnostics.length).toBe(1);
    expect(runner.diagnostics[0].toolNames).toContain('session_stats');
    expect(runner.diagnostics[0].handlerCounts['tool_call']).toBe(1);
    expect(runner.diagnostics[0].handlerCounts['agent_end']).toBe(1);

    // Used tiers should reflect universal events
    expect(runner.usedTiers.has('universal')).toBe(true);
  });

  it('ctx-aware extension receives ctx with providers and workspace', async () => {
    const providers = createMockProviders();
    // Mock memory.search to return a "blocked" entry
    providers.memory!.search = vi.fn().mockResolvedValue([
      { content: '/project/secret.ts', type: 'policy', source: 'test', date: '2026-03-01' },
    ]);

    const eventBus = new EventBus();
    const extensions = await loadExtensions(
      [join(fixtureDir, 'ctx-aware.js')],
      providers,
      eventBus,
    );
    const runner = new ExtensionRunner(extensions);

    // Build a ctx like the runtime does
    const ctx = {
      workspaceRoot: '/my/workspace',
      events: eventBus,
      providers: {
        memory: {
          search: (q: string, l?: string[]) => providers.memory!.search(q, l),
          store: (e: unknown) => providers.memory!.store(e as never),
        },
      },
    };

    // ctx-aware blocks writes to files found in memory
    const blocked = await runner.fireUntilBlocked('tool_call', {
      tool: 'Write',
      input: { file_path: '/project/secret.ts' },
    }, ctx);
    expect(blocked).not.toBeNull();
    expect(blocked!.decision).toBe('block');
    expect(blocked!.reason).toContain('memory policy');

    // ctx-aware injects workspace root via context_inject
    const results = await runner.fire<{ inject?: string }>('context_inject', {
      prompt: 'test',
      labels: [],
    }, ctx);
    expect(results).toHaveLength(1);
    expect(results[0].inject).toBe('Workspace: /my/workspace');

    // ctx-aware emits event on session_start via ctx.events
    const startHandler = vi.fn();
    eventBus.on('extension:ctx-aware:started', startHandler);
    await runner.fire('session_start', undefined, ctx);
    expect(startHandler).toHaveBeenCalledWith({ workspace: '/my/workspace' });
  });
});
