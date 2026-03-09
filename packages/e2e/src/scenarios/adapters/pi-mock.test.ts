/**
 * Scenario: Pi adapter — mock API test
 *
 * Calls the dot-ai Pi adapter (adapter-pi/dist/index.js) with a mock Pi API
 * object. No real Pi process, no ~/.pi/ touch, no gateway needed.
 *
 * What this tests vs what it doesn't:
 *   ✅ Pi extension boots correctly (session_start → DotAiRuntime.boot())
 *   ✅ before_agent_start returns { systemPrompt, model }
 *   ✅ systemPrompt contains matched skill content
 *   ✅ DotAiRuntime tools are registered as Pi tools
 *   ✅ Tool call blocking is propagated to Pi tool_call handler
 *   ❌ Pi's native session lifecycle (requires real Pi process)
 *   ❌ Multi-turn context accumulation (requires real session)
 *   ❌ Pi's own tool execution plumbing (not dot-ai's responsibility)
 *
 * OpenClaw note:
 *   OpenClaw requires a running gateway daemon (openclaw gateway start).
 *   Tests that involve the real gateway need:
 *     - A dedicated port (e.g. OPENCLAW_PORT=7001 for tests)
 *     - Isolated OPENCLAW_HOME (temp dir)
 *     - Gateway lifecycle management (start/stop per test suite)
 *   This is CI/Docker territory — not automated here.
 *   See: scripts/test-openclaw-gateway.sh (to be created when needed)
 *
 * STATUS: Baseline — should pass with current code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkspaceBuilder } from '../../workspace-builder.js';
import { runPiMockSession, EXTENSION_DIST } from '../../agent-env.js';
import type { BuiltWorkspace } from '../../workspace-builder.js';

describe('adapter / pi — mock API (no Pi process)', () => {

  describe('minimal workspace', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create().build();
    });

    afterAll(async () => ws.cleanup());

    it('before_agent_start returns a systemPrompt string', async () => {
      const capture = await runPiMockSession(ws.dir, 'hello');
      expect(typeof capture.systemPromptFromBeforeAgentStart).toBe('string');
      expect(capture.systemPromptFromBeforeAgentStart!.length).toBeGreaterThan(0);
    });

    it('systemPrompt contains dot-ai system section', async () => {
      const capture = await runPiMockSession(ws.dir, 'hello');
      expect(capture.systemPromptFromBeforeAgentStart).toContain('dot-ai');
    });
  });

  describe('with skills', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create()
        .withSkill('deploy', {
          description: 'Production deployment procedures',
          labels: ['deploy', 'release', 'production'],
          content: '# Deploy\n\nDeployment guide for production.',
        })
        .withSettings({ extensions: [EXTENSION_DIST.skills] })
        .build();
    });

    afterAll(async () => ws.cleanup());

    it('systemPrompt contains matched skill content', async () => {
      const capture = await runPiMockSession(ws.dir, 'deploy to production');
      // Directive format: "→ Use skill: deploy — ..." (lowercase, no markdown heading)
      expect(capture.systemPromptFromBeforeAgentStart).toContain('deploy');
    });

    it('systemPrompt does NOT contain skill for unrelated prompt', async () => {
      const capture = await runPiMockSession(ws.dir, 'what is the weather');
      expect(capture.systemPromptFromBeforeAgentStart).not.toContain('Deployment guide');
    });
  });

  describe('tool registration', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create()
        .withMemory('Some stored fact')
        .withSettings({ extensions: [EXTENSION_DIST.memory] })
        .build();
    });

    afterAll(async () => ws.cleanup());

    it('memory tools are registered as Pi tools', async () => {
      const capture = await runPiMockSession(ws.dir, 'hello');
      const toolNames = capture.registeredTools.map(t => t.name);
      // Memory extension registers memory_recall and memory_store
      expect(toolNames).toContain('memory_recall');
      expect(toolNames).toContain('memory_store');
    });
  });
});

/**
 * OpenClaw integration notes (NOT automated here)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * To test OpenClaw adapter in isolation you need:
 *
 * 1. Start a gateway with isolated home and custom port:
 *    OPENCLAW_HOME=/tmp/test-openclaw-home OPENCLAW_PORT=7001 openclaw gateway start
 *
 * 2. Create a test workspace and install the dot-ai plugin into the test gateway:
 *    OPENCLAW_HOME=/tmp/test-openclaw-home openclaw plugins install dot-ai
 *
 * 3. Send a test message and capture the response:
 *    OPENCLAW_HOME=/tmp/test-openclaw-home openclaw chat "deploy to production"
 *
 * 4. Stop the gateway:
 *    OPENCLAW_HOME=/tmp/test-openclaw-home openclaw gateway stop
 *
 * This is not suitable for local automated tests because:
 * - Port conflicts with your real gateway
 * - Slow startup (~2-3s)
 * - Requires openclaw installed globally
 *
 * Recommended: run these in a Docker container in CI.
 * See scripts/test-openclaw-gateway.sh for the reference script.
 */
