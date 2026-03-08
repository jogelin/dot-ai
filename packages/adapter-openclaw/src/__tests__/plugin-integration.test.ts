import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { DotAiRuntime, EventBus, formatSections } from '@dot-ai/core';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../../package.json') as { version: string };

// ── Mock OpenClaw Plugin API ──

interface CapturedHook {
  event: string;
  handler: (...args: unknown[]) => unknown;
  options?: { priority?: number };
}

interface CapturedInternalHook {
  events: string | string[];
  handler: (...args: unknown[]) => unknown;
  opts?: { name?: string; description?: string };
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
  const internalHooks: CapturedInternalHook[] = [];
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
    registerHook(
      events: string | string[],
      handler: (...args: unknown[]) => unknown,
      opts?: { name?: string; description?: string },
    ) {
      internalHooks.push({ events, handler, opts });
    },
    registerService(service: CapturedService) {
      services.push(service);
    },
    registerTool(factory: (ctx: Record<string, unknown>) => unknown, opts?: { name?: string; names?: string[] }) {
      tools.push({ factory, opts });
    },
  };

  return { api, logs, hooks, internalHooks, services, tools };
}

// ── Tests ──

describe('OpenClaw Plugin Integration', () => {
  describe('plugin.register() structure', () => {
    it('registers before_prompt_build hook with priority 10', async () => {
      const { api, hooks } = createMockOpenClawApi();

      const { default: plugin } = await import('../index.js');
      plugin.register(api as never);

      const beforeBuild = hooks.find(h => h.event === 'before_prompt_build');
      expect(beforeBuild).toBeDefined();
      expect(beforeBuild!.options?.priority).toBe(10);
    });

    it('registers agent:bootstrap internal hook', async () => {
      const { api, internalHooks } = createMockOpenClawApi();
      const { default: plugin } = await import('../index.js');
      plugin.register(api as never);

      const bootstrapHook = internalHooks.find(h => h.events === 'agent:bootstrap');
      expect(bootstrapHook).toBeDefined();
      expect(bootstrapHook!.opts?.name).toBe('dot-ai-bootstrap-filter');
    });

    it('agent:bootstrap hook removes all bootstrap files', async () => {
      const { api, internalHooks } = createMockOpenClawApi();
      const { default: plugin } = await import('../index.js');
      plugin.register(api as never);

      const bootstrapHook = internalHooks.find(h => h.events === 'agent:bootstrap')!;
      const event = {
        type: 'agent',
        action: 'bootstrap',
        sessionKey: 'test',
        context: {
          workspaceDir: '/tmp/test',
          bootstrapFiles: [
            { name: 'AGENTS.md', path: '/tmp/AGENTS.md', content: '# Agents', missing: false },
            { name: 'SOUL.md', path: '/tmp/SOUL.md', content: '# Soul', missing: false },
            { name: 'IDENTITY.md', path: '/tmp/IDENTITY.md', content: '# Identity', missing: false },
            { name: 'USER.md', path: '/tmp/USER.md', content: '# User', missing: false },
            { name: 'TOOLS.md', path: '/tmp/TOOLS.md', content: '# Tools', missing: false },
            { name: 'HEARTBEAT.md', path: '/tmp/HEARTBEAT.md', content: '', missing: false },
          ],
        },
        timestamp: new Date(),
        messages: [],
      };

      bootstrapHook.handler(event);
      expect(event.context.bootstrapFiles).toEqual([]);
    });

    it('registers agent_end hook', async () => {
      const { api, hooks } = createMockOpenClawApi();
      const { default: plugin } = await import('../index.js');
      plugin.register(api as never);

      const agentEnd = hooks.find(h => h.event === 'agent_end');
      expect(agentEnd).toBeDefined();
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

    it('logs plugin version', async () => {
      const { api, logs } = createMockOpenClawApi();
      const { default: plugin } = await import('../index.js');
      plugin.register(api as never);

      expect(logs.some(l => l.includes(`v${PKG_VERSION}`))).toBe(true);
    });

    it('has correct plugin metadata', async () => {
      const { default: plugin } = await import('../index.js');
      expect(plugin.id).toBe('dot-ai');
      expect(plugin.version).toBe(PKG_VERSION);
      expect(plugin.kind).toBe('memory');
    });
  });

  describe('before_prompt_build → boot → processPrompt', () => {
    it('skips sub-agent sessions', async () => {
      const { api, hooks, logs } = createMockOpenClawApi();
      const { default: plugin } = await import('../index.js');
      plugin.register(api as never);

      const beforeBuild = hooks.find(h => h.event === 'before_prompt_build')!;
      const result = await beforeBuild.handler(
        { prompt: 'hello' },
        { workspaceDir: '/tmp/test', sessionKey: 'session:subagent:1' },
      );

      expect(result).toBeUndefined();
      expect(logs.some(l => l.includes('Sub-agent'))).toBe(true);
    });

    it('skips cron sessions', async () => {
      const { api, hooks, logs } = createMockOpenClawApi();
      const { default: plugin } = await import('../index.js');
      plugin.register(api as never);

      const beforeBuild = hooks.find(h => h.event === 'before_prompt_build')!;
      const result = await beforeBuild.handler(
        { prompt: 'cleanup' },
        { workspaceDir: '/tmp/test', sessionKey: 'session:cron:cleanup' },
      );

      expect(result).toBeUndefined();
      expect(logs.some(l => l.includes('Sub-agent') || l.includes('cron'))).toBe(true);
    });

    it('skips when no workspaceDir and no .ai/ in cwd', async () => {
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/tmp');

      const { api, hooks, logs } = createMockOpenClawApi();
      const { default: plugin } = await import('../index.js');
      plugin.register(api as never);

      const beforeBuild = hooks.find(h => h.event === 'before_prompt_build')!;
      const result = await beforeBuild.handler(
        { prompt: 'hello' },
        {},
      );

      expect(result).toBeUndefined();
      expect(logs.some(l => l.includes('No workspace found'))).toBe(true);

      cwdSpy.mockRestore();
    });
  });

  describe('DotAiRuntime lifecycle (v7)', () => {
    it('boots and processes prompt returning sections', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
      });
      await runtime.boot();
      expect(runtime.isBooted).toBe(true);

      const { sections } = await runtime.processPrompt('hello world');
      expect(sections).toBeDefined();
      expect(Array.isArray(sections)).toBe(true);

      const formatted = formatSections(sections);
      expect(typeof formatted).toBe('string');
    });

    it('diagnostics show extension info', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
      });
      await runtime.boot();

      const diag = runtime.diagnostics;
      expect(diag.extensions).toEqual([]);
      expect(diag.capabilityCount).toBe(0);
    });

    it('fire agent_end without throwing', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
      });
      await runtime.boot();
      await runtime.fire('agent_end', { response: 'test response' });
    });
  });

  describe('EventBus inter-extension communication', () => {
    it('extensions can communicate via EventBus', async () => {
      const eventBus = new EventBus();
      const received: unknown[] = [];

      eventBus.on('custom:auth-fix', (data: unknown) => {
        received.push(data);
      });

      eventBus.emit('custom:auth-fix', { file: 'auth.ts', action: 'refactored' });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ file: 'auth.ts', action: 'refactored' });
    });

    it('EventBus errors dont propagate', () => {
      const eventBus = new EventBus();
      eventBus.on('test', () => { throw new Error('boom'); });

      expect(() => eventBus.emit('test')).not.toThrow();
    });
  });
});
