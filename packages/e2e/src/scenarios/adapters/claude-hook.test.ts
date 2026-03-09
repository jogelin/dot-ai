/**
 * Scenario: Claude Code adapter — hook subprocess test
 *
 * Tests adapter-claude/dist/hook.js as a real subprocess with a fully
 * isolated HOME directory (no ~/.claude/ touch, no ~/.ai/ pollution).
 *
 * Tests the full Claude adapter path:
 *   event JSON (stdin) → hook.js → DotAiRuntime → formatSections → stdout JSON
 *
 * What this tests vs what it doesn't:
 *   ✅ hook.js boots correctly with an isolated workspace
 *   ✅ UserPromptSubmit event produces { result: markdown } on stdout
 *   ✅ Injected markdown contains system section
 *   ✅ Injected markdown contains matched skill content
 *   ✅ PreToolUse event returns block/allow decisions
 *   ✅ HOME is isolated (no ~/.claude/ access or pollution)
 *   ❌ Does Claude Code actually USE the injected context? (manual smoke test)
 *   ❌ Full Claude Code session lifecycle (requires real agent)
 *
 * STATUS: Baseline — should pass with current code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkspaceBuilder } from '../../workspace-builder.js';
import { IsolatedAgentEnv, invokeClaudeHook, EXTENSION_DIST } from '../../agent-env.js';
import type { BuiltWorkspace } from '../../workspace-builder.js';

describe('adapter / claude-hook — subprocess (isolated HOME)', () => {
  let agentEnv: IsolatedAgentEnv;

  beforeAll(async () => {
    agentEnv = await IsolatedAgentEnv.create();
  });

  afterAll(async () => agentEnv.cleanup());

  describe('UserPromptSubmit (prompt-submit)', () => {
    describe('minimal workspace — no extensions', () => {
      let ws: BuiltWorkspace;

      beforeAll(async () => {
        ws = await WorkspaceBuilder.create().build();
      });

      afterAll(async () => ws.cleanup());

      it('exits with code 0', async () => {
        const result = await invokeClaudeHook(
          'prompt-submit',
          { cwd: ws.dir, prompt: 'hello' },
          agentEnv,
        );
        expect(result.exitCode).toBe(0);
      });

      it('outputs valid JSON on stdout', async () => {
        const result = await invokeClaudeHook(
          'prompt-submit',
          { cwd: ws.dir, prompt: 'hello' },
          agentEnv,
        );
        expect(result.json).not.toBeNull();
        expect(result.json).toHaveProperty('result');
      });

      it('injected context is a non-empty string', async () => {
        const result = await invokeClaudeHook(
          'prompt-submit',
          { cwd: ws.dir, prompt: 'hello' },
          agentEnv,
        );
        expect(typeof result.injectedContext).toBe('string');
        expect(result.injectedContext!.length).toBeGreaterThan(0);
      });

      it('injected context contains dot-ai system section', async () => {
        const result = await invokeClaudeHook(
          'prompt-submit',
          { cwd: ws.dir, prompt: 'hello' },
          agentEnv,
        );
        expect(result.injectedContext).toContain('dot-ai');
      });
    });

    describe('workspace with skill — matched prompt', () => {
      let ws: BuiltWorkspace;

      beforeAll(async () => {
        // The Claude hook boots DotAiRuntime independently from settings.json.
        // We must tell it which extension to load via settings, otherwise it
        // discovers no extensions and injects no skills.
        ws = await WorkspaceBuilder.create()
          .withSkill('deploy', {
            description: 'Production deployment procedures',
            labels: ['deploy', 'release', 'production'],
            content: '# Deploy\n\nThis is the deployment guide.',
          })
          // settings.json uses Pi-compatible format: "extensions" is a flat array of paths
          .withSettings({ extensions: [EXTENSION_DIST.skills] })
          .build();
      });

      afterAll(async () => ws.cleanup());

      it('injected context contains skill content when prompt matches', async () => {
        const result = await invokeClaudeHook(
          'prompt-submit',
          { cwd: ws.dir, prompt: 'deploy to production' },
          agentEnv,
        );
        // Directive format: "→ Use skill: deploy — ..." (lowercase skill name, no markdown heading)
        expect(result.injectedContext).toContain('deploy');
      });

      it('injected context does NOT contain skill when prompt does not match', async () => {
        const result = await invokeClaudeHook(
          'prompt-submit',
          { cwd: ws.dir, prompt: 'what is 2 + 2' },
          agentEnv,
        );
        // System section should be there, but not the deploy skill
        expect(result.injectedContext).toContain('dot-ai');
        expect(result.injectedContext).not.toContain('deployment guide');
      });
    });

    describe('isolation guarantees', () => {
      let ws: BuiltWorkspace;

      beforeAll(async () => {
        ws = await WorkspaceBuilder.create().build();
      });

      afterAll(async () => ws.cleanup());

      it('does not write to the real HOME directory', async () => {
        const realHome = process.env.HOME ?? '/tmp';
        const { stat } = await import('node:fs/promises');

        // Record modification time of real home before hook
        const before = (await stat(realHome)).mtimeMs;

        await invokeClaudeHook(
          'prompt-submit',
          { cwd: ws.dir, prompt: 'hello' },
          agentEnv,
        );

        // Real home should not have been touched
        const after = (await stat(realHome)).mtimeMs;
        expect(after).toBe(before);
      });

      it('each test gets its own isolated home (no cross-test contamination)', async () => {
        // Create two isolated envs
        const env1 = await IsolatedAgentEnv.create();
        const env2 = await IsolatedAgentEnv.create();

        expect(env1.home).not.toBe(env2.home);

        await env1.cleanup();
        await env2.cleanup();
      });
    });
  });

  describe('session-start', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create().build();
    });

    afterAll(async () => ws.cleanup());

    it('exits with code 0', async () => {
      const result = await invokeClaudeHook(
        'session-start',
        { cwd: ws.dir },
        agentEnv,
      );
      expect(result.exitCode).toBe(0);
    });

    it('does not produce a result on stdout (session-start is diagnostic only)', async () => {
      const result = await invokeClaudeHook(
        'session-start',
        { cwd: ws.dir },
        agentEnv,
      );
      // session-start should not inject context (no prompt yet)
      expect(result.injectedContext).toBeNull();
    });
  });

  describe('pre-tool-use', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create().build();
    });

    afterAll(async () => ws.cleanup());

    it('allows safe tool calls (no block decision)', async () => {
      const result = await invokeClaudeHook(
        'pre-tool-use',
        {
          cwd: ws.dir,
          tool_name: 'Read',
          tool_input: { file_path: '/tmp/safe-file.txt' },
        },
        agentEnv,
      );
      // No block → no JSON output or allow decision
      expect(result.exitCode).toBe(0);
      if (result.json) {
        expect(result.json['decision']).not.toBe('block');
      }
    });

    it('blocks writes to .ai/memory/*.md files', async () => {
      const result = await invokeClaudeHook(
        'pre-tool-use',
        {
          cwd: ws.dir,
          tool_name: 'Write',
          tool_input: { file_path: '.ai/memory/2026-01-01.md' },
        },
        agentEnv,
      );
      expect(result.exitCode).toBe(0);
      expect(result.json?.['decision']).toBe('block');
    });
  });
});
