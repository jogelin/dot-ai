import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Providers } from '@dot-ai/core';
import { DotAiRuntime, loadExtensions, ExtensionRunner, EventBus, ADAPTER_CAPABILITIES } from '@dot-ai/core';
import { join } from 'node:path';

// Fixture extensions from core package
const fixtureDir = join(import.meta.dirname, '..', '..', '..', 'core', 'src', '__tests__', 'fixtures', 'extensions');

// ── Mock OpenClaw Plugin API ──

interface CapturedHook {
  event: string;
  handler: (...args: unknown[]) => unknown;
  options?: { priority?: number };
}

interface CapturedService {
  id: string;
  start: (ctx: { logger: { info: (msg: string) => void } }) => void;
  stop: (ctx: { logger: { info: (msg: string) => void } }) => void;
}

interface CapturedTool {
  factory?: (ctx: Record<string, unknown>) => unknown;
  opts?: { name?: string; names?: string[] };
}

function createMockOpenClawApi() {
  const logs: string[] = [];
  const hooks: CapturedHook[] = [];
  const services: CapturedService[] = [];
  const tools: CapturedTool[] = [];

  const api = {
    logger: {
      info: (msg: string) => logs.push(msg),
      debug: (msg: string) => logs.push(`[debug] ${msg}`),
    },
    pluginConfig: undefined as Record<string, unknown> | undefined,
    on(
      event: string,
      handler: (...args: unknown[]) => unknown,
      options?: { priority?: number },
    ) {
      hooks.push({ event, handler, options });
    },
    registerService(service: CapturedService) {
      services.push(service);
    },
    registerTool(factory: (ctx: Record<string, unknown>) => unknown, opts?: { name?: string; names?: string[] }) {
      tools.push({ factory, opts });
    },
  };

  return { api, logs, hooks, services, tools };
}

// ── Mock providers ──

function createMockProviders(overrides?: Partial<Providers>): Providers {
  return {
    memory: {
      search: vi.fn().mockResolvedValue([
        { content: 'Previous auth fix applied JWT rotation', type: 'decision', source: 'sqlite' },
      ]),
      store: vi.fn().mockResolvedValue(undefined),
      describe: vi.fn().mockReturnValue('Mock memory'),
    },
    skills: {
      list: vi.fn().mockResolvedValue([]),
      match: vi.fn().mockResolvedValue([]),
      load: vi.fn().mockResolvedValue(null),
    },
    identity: {
      load: vi.fn().mockResolvedValue([
        { type: 'agents', content: 'You are a helpful assistant.', source: 'file', priority: 10 },
      ]),
    },
    routing: {
      route: vi.fn().mockResolvedValue({ model: 'sonnet', reason: 'default' }),
    },
    tasks: {
      list: vi.fn().mockResolvedValue([
        { id: '1', text: 'Fix auth bug', status: 'in_progress' },
      ]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'new-1', text: 'New task', status: 'pending' }),
      update: vi.fn().mockResolvedValue({ id: '1', text: 'Fix auth bug', status: 'done' }),
    },
    tools: {
      list: vi.fn().mockResolvedValue([]),
      match: vi.fn().mockResolvedValue([]),
      load: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
  };
}

// ── Tests ──

describe('OpenClaw Plugin Integration', () => {
  describe('plugin.register() structure', () => {
    it('registers before_agent_start hook with priority 10', async () => {
      const { api, hooks } = createMockOpenClawApi();

      // Dynamically import the plugin to simulate OpenClaw loading it
      const { default: plugin } = await import('../index.js');
      plugin.register(api as never);

      const beforeStart = hooks.find(h => h.event === 'before_agent_start');
      expect(beforeStart).toBeDefined();
      expect(beforeStart!.options?.priority).toBe(10);
    });

    it('registers after_agent_end hook', async () => {
      const { api, hooks } = createMockOpenClawApi();
      const { default: plugin } = await import('../index.js');
      plugin.register(api as never);

      const afterEnd = hooks.find(h => h.event === 'after_agent_end');
      expect(afterEnd).toBeDefined();
    });

    it('registers dot-ai service', async () => {
      const { api, services } = createMockOpenClawApi();
      const { default: plugin } = await import('../index.js');
      plugin.register(api as never);

      const svc = services.find(s => s.id === 'dot-ai');
      expect(svc).toBeDefined();
    });

    it('registers tool factory for capabilities', async () => {
      const { api, tools } = createMockOpenClawApi();
      const { default: plugin } = await import('../index.js');
      plugin.register(api as never);

      expect(tools.length).toBe(1);
      expect(tools[0].opts?.names).toContain('memory_recall');
      expect(tools[0].opts?.names).toContain('memory_store');
      expect(tools[0].opts?.names).toContain('task_list');
    });

    it('logs plugin version v5', async () => {
      const { api, logs } = createMockOpenClawApi();
      const { default: plugin } = await import('../index.js');
      plugin.register(api as never);

      expect(logs.some(l => l.includes('v6'))).toBe(true);
    });

    it('has correct plugin metadata', async () => {
      const { default: plugin } = await import('../index.js');
      expect(plugin.id).toBe('dot-ai');
      expect(plugin.version).toBe('6.0.0');
      expect(plugin.kind).toBe('memory');
    });
  });

  describe('before_agent_start → boot → processPrompt', () => {
    it('skips sub-agent sessions', async () => {
      const { api, hooks, logs } = createMockOpenClawApi();
      const { default: plugin } = await import('../index.js');
      plugin.register(api as never);

      const beforeStart = hooks.find(h => h.event === 'before_agent_start')!;
      const result = await beforeStart.handler(
        {},
        { workspaceDir: '/tmp/test', sessionKey: 'session:subagent:1', prompt: 'hello' },
      );

      expect(result).toBeUndefined();
      expect(logs.some(l => l.includes('Sub-agent'))).toBe(true);
    });

    it('skips cron sessions', async () => {
      const { api, hooks, logs } = createMockOpenClawApi();
      const { default: plugin } = await import('../index.js');
      plugin.register(api as never);

      const beforeStart = hooks.find(h => h.event === 'before_agent_start')!;
      const result = await beforeStart.handler(
        {},
        { workspaceDir: '/tmp/test', sessionKey: 'session:cron:cleanup', prompt: 'cleanup' },
      );

      expect(result).toBeUndefined();
      expect(logs.some(l => l.includes('Sub-agent') || l.includes('cron'))).toBe(true);
    });

    it('skips when no workspaceDir', async () => {
      const { api, hooks, logs } = createMockOpenClawApi();
      const { default: plugin } = await import('../index.js');
      plugin.register(api as never);

      const beforeStart = hooks.find(h => h.event === 'before_agent_start')!;
      const result = await beforeStart.handler(
        {},
        { prompt: 'hello' },
      );

      expect(result).toBeUndefined();
      expect(logs.some(l => l.includes('No workspaceDir'))).toBe(true);
    });
  });

  describe('DotAiRuntime lifecycle (simulated OpenClaw flow)', () => {
    let providers: Providers;

    beforeEach(() => {
      providers = createMockProviders();
    });

    it('full before_agent_start → tool_execution → after_agent_end flow', async () => {
      // === Step 1: before_agent_start — boot runtime + process prompt ===
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
        skipIdentities: true, // OpenClaw skips identities
      });
      await runtime.boot();
      expect(runtime.isBooted).toBe(true);

      const { formatted, capabilities } = await runtime.processPrompt(
        'list all tasks and fix the security issue',
      );

      // OpenClaw would return { prependContext: formatted }
      expect(formatted).toBeTruthy();
      expect(formatted).toContain('Relevant Memory');
      // skipIdentities means no identity content
      expect(formatted).not.toContain('You are a helpful assistant');

      // Capabilities registered for OpenClaw tools
      const capNames = capabilities.map(c => c.name);
      expect(capNames).toContain('memory_recall');
      expect(capNames).toContain('memory_store');
      expect(capNames).toContain('task_list');
      expect(capNames).toContain('task_create');
      expect(capNames).toContain('task_update');

      // === Step 2: Agent uses tools during session ===
      const taskListCap = capabilities.find(c => c.name === 'task_list')!;
      const tasks = await taskListCap.execute({});
      expect(tasks.text).toContain('Fix auth bug');

      const memoryCap = capabilities.find(c => c.name === 'memory_store')!;
      await memoryCap.execute({ text: 'Security fix applied', type: 'decision' });
      expect(providers.memory!.store).toHaveBeenCalled();

      const recallCap = capabilities.find(c => c.name === 'memory_recall')!;
      const recalled = await recallCap.execute({ query: 'auth' });
      expect(recalled.text).toContain('auth fix');

      // === Step 3: after_agent_end — learn from response ===
      const response = 'Refactored the authentication module to use proper JWT validation with token rotation. Added input sanitization across all API endpoints for enhanced security.';
      await runtime.learn(response);
      // learn fires agent_end event to extensions (no extensions loaded here, but pipeline runs)
    });

    it('multiple prompts reuse boot cache (session persistence)', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
        skipIdentities: true,
      });
      await runtime.boot();

      // First prompt
      await runtime.processPrompt('fix the auth bug');
      // Second prompt (same session)
      await runtime.processPrompt('now update the tests');

      // identity.load called once at boot
      expect(providers.identity!.load).toHaveBeenCalledOnce();
      // memory.search called per prompt
      expect(providers.memory!.search).toHaveBeenCalledTimes(2);
    });

    it('diagnostics show provider status', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
      });
      await runtime.boot();

      const diag = runtime.diagnostics;
      expect(diag.providerStatus['memory']).toBe(true);
      expect(diag.providerStatus['skills']).toBe(true);
      expect(diag.providerStatus['identity']).toBe(true);
      expect(diag.providerStatus['routing']).toBe(true);
      expect(diag.providerStatus['tasks']).toBe(true);
      expect(diag.providerStatus['tools']).toBe(true);
      expect(diag.capabilityCount).toBeGreaterThan(0);
    });

    it('partial providers still work', async () => {
      // OpenClaw workspace with only memory configured
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers: { memory: providers.memory },
        skipIdentities: true,
      });
      await runtime.boot();

      const { formatted } = await runtime.processPrompt('fix memory');
      expect(formatted).toContain('Relevant Memory');

      const diag = runtime.diagnostics;
      expect(diag.providerStatus['memory']).toBe(true);
      expect(diag.providerStatus['skills']).toBe(false);
      expect(diag.providerStatus['tasks']).toBe(false);
    });
  });

  describe('extension integration via DotAiRuntime', () => {
    let providers: Providers;

    beforeEach(() => {
      providers = createMockProviders();
    });

    it('extensions fire context_inject during processPrompt', async () => {
      // Load smart-context extension manually (simulates what runtime does at boot)
      const eventBus = new EventBus();
      const extensions = await loadExtensions(
        [join(fixtureDir, 'smart-context.js')],
        providers,
        eventBus,
      );
      const runner = new ExtensionRunner(extensions);

      // Fire context_inject with memory label (what runtime does in processPrompt)
      const results = await runner.fire<{ inject?: string }>('context_inject', {
        prompt: 'fix memory leak',
        labels: [{ name: 'memory', source: 'extract' }],
      });

      const injected = results.find(r => r.inject);
      expect(injected).toBeDefined();
      expect(injected!.inject).toContain('memory_recall');
    });

    it('extensions fire agent_end during learn', async () => {
      const eventBus = new EventBus();
      const extensions = await loadExtensions(
        [join(fixtureDir, 'session-analytics.js')],
        providers,
        eventBus,
      );
      const runner = new ExtensionRunner(extensions);

      // Simulate tool calls during agent execution
      await runner.fire('tool_call', { tool: 'Read', input: {} });
      await runner.fire('tool_call', { tool: 'Write', input: {} });

      // Fire agent_end (what runtime does in learn())
      await runner.fire('agent_end', { response: 'Done fixing the issue.' });

      // Analytics tool should reflect the session
      const statsTool = runner.tools.find(t => t.name === 'session_stats');
      expect(statsTool).toBeDefined();
      const stats = await statsTool!.execute({});
      expect(stats.content).toContain('Total calls: 2');
    });

    it('extension tools become runtime capabilities', async () => {
      const eventBus = new EventBus();
      const extensions = await loadExtensions(
        [join(fixtureDir, 'session-analytics.js')],
        providers,
        eventBus,
      );
      const runner = new ExtensionRunner(extensions);

      // Extension registered session_stats tool
      expect(runner.tools).toHaveLength(1);
      expect(runner.tools[0].name).toBe('session_stats');

      // In the real adapter, these become OpenClaw tools via api.registerTool
      const tool = runner.tools[0];
      const result = await tool.execute({});
      expect(result.content).toContain('Total calls:');
    });

    it('extension diagnostics are available after boot', async () => {
      const eventBus = new EventBus();
      const extensions = await loadExtensions(
        [
          join(fixtureDir, 'security-gate.js'),
          join(fixtureDir, 'smart-context.js'),
          join(fixtureDir, 'session-analytics.js'),
        ],
        providers,
        eventBus,
      );
      const runner = new ExtensionRunner(extensions);

      const diag = runner.diagnostics;
      expect(diag).toHaveLength(3);

      // Security gate: tool_call handler, no tools
      const secGate = diag.find(d => d.path.includes('security-gate'));
      expect(secGate).toBeDefined();
      expect(secGate!.handlerCounts['tool_call']).toBe(1);
      expect(secGate!.toolNames).toEqual([]);

      // Analytics: tool_call + agent_end handlers, 1 tool
      const analytics = diag.find(d => d.path.includes('session-analytics'));
      expect(analytics).toBeDefined();
      expect(analytics!.handlerCounts['tool_call']).toBe(1);
      expect(analytics!.handlerCounts['agent_end']).toBe(1);
      expect(analytics!.toolNames).toContain('session_stats');
    });
  });

  describe('OpenClaw adapter capability matrix', () => {
    it('OpenClaw supports context_inject, agent_end, session_start', () => {
      const supported = ADAPTER_CAPABILITIES['openclaw'];
      expect(supported.has('context_inject')).toBe(true);
      expect(supported.has('agent_end')).toBe(true);
      expect(supported.has('session_start')).toBe(true);
    });

    it('OpenClaw does NOT support tool_call, tool_result, context_modify', () => {
      const supported = ADAPTER_CAPABILITIES['openclaw'];
      expect(supported.has('tool_call')).toBe(false);
      expect(supported.has('tool_result')).toBe(false);
      expect(supported.has('context_modify')).toBe(false);
      expect(supported.has('turn_start')).toBe(false);
      expect(supported.has('turn_end')).toBe(false);
    });

    it('extensions using unsupported events are loaded but handlers wont fire', async () => {
      // security-gate uses tool_call — which OpenClaw doesn't support
      const eventBus = new EventBus();
      const extensions = await loadExtensions(
        [join(fixtureDir, 'security-gate.js')],
        undefined,
        eventBus,
      );
      const runner = new ExtensionRunner(extensions);

      // Extension IS loaded
      expect(runner.diagnostics).toHaveLength(1);
      expect(runner.diagnostics[0].handlerCounts['tool_call']).toBe(1);

      // But in OpenClaw, the adapter never calls fireToolCall()
      // so the handler never fires — this is by design.
      // The adapter could warn about this:
      const supported = ADAPTER_CAPABILITIES['openclaw'];
      for (const eventName of Object.keys(runner.diagnostics[0].handlerCounts)) {
        if (!supported.has(eventName)) {
          // This extension uses tool_call which OpenClaw doesn't support
          expect(eventName).toBe('tool_call');
        }
      }
    });
  });

  describe('full simulated OpenClaw session', () => {
    it('complete lifecycle: boot → multi-prompt → tool use → learn → shutdown', async () => {
      const providers = createMockProviders();

      // === OpenClaw boots the plugin ===
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
        skipIdentities: true,
      });
      await runtime.boot();

      // Extension diagnostics (OpenClaw logs these)
      const diag = runtime.diagnostics;
      expect(diag.extensions).toEqual([]); // no .ai/extensions/ in /tmp
      expect(diag.providerStatus['memory']).toBe(true);

      // === First agent turn ===
      const r1 = await runtime.processPrompt('What tasks are pending?');
      expect(r1.formatted).toBeTruthy();

      // Agent uses task_list tool
      const taskCap = r1.capabilities.find(c => c.name === 'task_list')!;
      const taskResult = await taskCap.execute({});
      expect(taskResult.text).toContain('Fix auth bug');

      // Agent response
      await runtime.learn(
        'I found one in-progress task: "Fix auth bug". Let me look into the authentication module to understand the issue and propose a fix.',
      );

      // === Second agent turn (same session) ===
      const r2 = await runtime.processPrompt('Now fix the auth bug');
      expect(r2.formatted).toBeTruthy();

      // Agent stores a memory
      const storeCap = r2.capabilities.find(c => c.name === 'memory_store')!;
      await storeCap.execute({ text: 'Auth bug fixed with JWT rotation', type: 'decision' });
      expect(providers.memory!.store).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Auth bug fixed with JWT rotation' }),
      );

      // Agent updates the task
      const updateCap = r2.capabilities.find(c => c.name === 'task_update')!;
      await updateCap.execute({ id: '1', status: 'done' });
      expect(providers.tasks!.update).toHaveBeenCalledWith('1', expect.objectContaining({ status: 'done' }));

      // Agent response
      await runtime.learn(
        'Fixed the authentication bug by implementing proper JWT token rotation with a 15-minute expiry window. Updated the task status to done.',
      );

      // === Verify session state ===
      // identity loaded once
      expect(providers.identity!.load).toHaveBeenCalledOnce();
      // memory searched per prompt
      expect(providers.memory!.search).toHaveBeenCalledTimes(2);
      // memory stored once via capability
      expect(providers.memory!.store).toHaveBeenCalled();

      // === Shutdown ===
      await runtime.shutdown();
    });
  });

  describe('EventBus inter-extension communication', () => {
    it('extensions can communicate via EventBus', async () => {
      const eventBus = new EventBus();
      const received: unknown[] = [];

      // Subscriber
      eventBus.on('custom:auth-fix', (data: unknown) => {
        received.push(data);
      });

      // Publisher
      eventBus.emit('custom:auth-fix', { file: 'auth.ts', action: 'refactored' });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ file: 'auth.ts', action: 'refactored' });
    });

    it('EventBus errors dont propagate', () => {
      const eventBus = new EventBus();
      eventBus.on('test', () => { throw new Error('boom'); });

      // Should not throw
      expect(() => eventBus.emit('test')).not.toThrow();
    });
  });
});
