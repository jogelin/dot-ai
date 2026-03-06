import { describe, it, expect } from 'vitest';
import { DotAiRuntime, EventBus, ADAPTER_CAPABILITIES } from '@dot-ai/core';

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

// ── Tests ──

describe('OpenClaw Plugin Integration', () => {
  describe('plugin.register() structure', () => {
    it('registers before_agent_start hook with priority 10', async () => {
      const { api, hooks } = createMockOpenClawApi();

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

    it('logs plugin version v6', async () => {
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

  describe('DotAiRuntime lifecycle (v6 extension-only)', () => {
    it('boots and processes prompt', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        skipIdentities: true,
      });
      await runtime.boot();
      expect(runtime.isBooted).toBe(true);

      const { formatted } = await runtime.processPrompt('hello world');
      expect(formatted).toBeDefined();
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

    it('learn fires agent_end without throwing', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
      });
      await runtime.boot();
      await runtime.learn('test response');
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
