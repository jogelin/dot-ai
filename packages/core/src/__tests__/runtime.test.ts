import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DotAiRuntime } from '../runtime.js';
import type { Providers } from '../engine.js';

function createMockProviders(overrides?: Partial<Providers>): Providers {
  return {
    memory: {
      search: vi.fn().mockResolvedValue([]),
      store: vi.fn().mockResolvedValue(undefined),
      describe: vi.fn().mockReturnValue('Mock memory'),
    },
    skills: {
      list: vi.fn().mockResolvedValue([]),
      match: vi.fn().mockResolvedValue([]),
      load: vi.fn().mockResolvedValue(null),
    },
    identity: {
      load: vi.fn().mockResolvedValue([]),
    },
    routing: {
      route: vi.fn().mockResolvedValue({ model: 'sonnet', reason: 'default' }),
    },
    tasks: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
    },
    tools: {
      list: vi.fn().mockResolvedValue([]),
      match: vi.fn().mockResolvedValue([]),
      load: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
  };
}

describe('DotAiRuntime', () => {
  let providers: Providers;

  beforeEach(() => {
    providers = createMockProviders();
  });

  describe('backward compatibility', () => {
    it('boots and processes prompts without extensions config', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
      });

      await runtime.boot();
      expect(runtime.isBooted).toBe(true);

      const result = await runtime.processPrompt('hello');
      expect(result.formatted).toBeDefined();
      expect(result.enriched).toBeDefined();
      expect(result.capabilities).toBeDefined();
    });

    it('providers getter works', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
      });
      await runtime.boot();
      expect(runtime.providers).toBe(providers);
    });

    it('isBooted is false before boot', () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
      });
      expect(runtime.isBooted).toBe(false);
    });

    it('flush works', async () => {
      const flushFn = vi.fn().mockResolvedValue(undefined);
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
        logger: { log: vi.fn(), flush: flushFn },
      });
      await runtime.flush();
      expect(flushFn).toHaveBeenCalledOnce();
    });

    it('learn works without extensions', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
      });
      await runtime.boot();
      // Short response — skipped by learn
      await runtime.learn('short');
      expect(providers.memory!.store).not.toHaveBeenCalled();
    });

    it('capabilities include memory and task tools', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
      });
      await runtime.boot();
      const names = runtime.capabilities.map(c => c.name);
      expect(names).toContain('memory_recall');
      expect(names).toContain('memory_store');
      expect(names).toContain('task_list');
    });
  });

  describe('extension integration', () => {
    it('runner is available after boot', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
      });
      await runtime.boot();
      expect(runtime.runner).not.toBeNull();
    });

    it('fire delegates to runner', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
      });
      await runtime.boot();
      // No extensions loaded, so fire returns empty
      const results = await runtime.fire('custom_event', { data: 1 });
      expect(results).toEqual([]);
    });

    it('fireToolCall delegates to runner', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
      });
      await runtime.boot();
      const result = await runtime.fireToolCall({ tool: 'test', input: {} });
      expect(result).toBeNull();
    });

    it('fireToolCall returns null when not booted', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
      });
      const result = await runtime.fireToolCall({ tool: 'test', input: {} });
      expect(result).toBeNull();
    });

    it('fire returns empty when not booted', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
      });
      const results = await runtime.fire('any');
      expect(results).toEqual([]);
    });

    it('shutdown fires session_end and flushes', async () => {
      const flushFn = vi.fn().mockResolvedValue(undefined);
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
        logger: { log: vi.fn(), flush: flushFn },
      });
      await runtime.boot();
      await runtime.shutdown();
      expect(flushFn).toHaveBeenCalledOnce();
    });

    it('shutdown works without boot', async () => {
      const flushFn = vi.fn().mockResolvedValue(undefined);
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
        logger: { log: vi.fn(), flush: flushFn },
      });
      // Should not throw
      await runtime.shutdown();
      expect(flushFn).toHaveBeenCalledOnce();
    });
  });

  describe('diagnostics', () => {
    it('returns diagnostics with extension info', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
      });
      await runtime.boot();
      const diag = runtime.diagnostics;
      expect(diag.extensions).toEqual([]);
      expect(diag.usedTiers).toEqual([]);
      expect(diag.providerStatus['memory']).toBe(true);
      expect(diag.providerStatus['skills']).toBe(true);
      expect(diag.capabilityCount).toBeGreaterThan(0);
    });

    it('returns diagnostics before boot', () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
      });
      const diag = runtime.diagnostics;
      expect(diag.extensions).toEqual([]);
      expect(diag.usedTiers).toEqual([]);
      expect(diag.capabilityCount).toBe(0);
    });

    it('shows provider status correctly', async () => {
      // Only memory provider configured
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers: { memory: providers.memory },
      });
      await runtime.boot();
      const diag = runtime.diagnostics;
      expect(diag.providerStatus['memory']).toBe(true);
      expect(diag.providerStatus['skills']).toBe(false);
      expect(diag.providerStatus['routing']).toBe(false);
    });
  });

  describe('boot idempotency', () => {
    it('second boot call is a no-op', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
      });
      await runtime.boot();
      await runtime.boot();
      // identity.load should only be called once
      expect(providers.identity!.load).toHaveBeenCalledOnce();
    });
  });

  describe('auto-boot on processPrompt', () => {
    it('boots automatically if not booted', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
      });
      expect(runtime.isBooted).toBe(false);
      await runtime.processPrompt('hello');
      expect(runtime.isBooted).toBe(true);
    });
  });

  describe('v6 extension pipeline', () => {
    it('boots in v6 mode when no providers given', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
      });
      await runtime.boot();
      expect(runtime.isBooted).toBe(true);
      expect(runtime.isV6).toBe(true);
      expect(runtime.providers).toBeNull();
    });

    it('boots in legacy mode when providers given', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        providers,
      });
      await runtime.boot();
      expect(runtime.isV6).toBe(false);
      expect(runtime.providers).toBe(providers);
    });

    it('processPrompt returns sections in v6 mode', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
      });
      await runtime.boot();
      const result = await runtime.processPrompt('hello world');
      expect(result.formatted).toBeDefined();
      expect(result.enriched).toBeDefined();
      expect(result.capabilities).toBeDefined();
      expect(result.labels).toBeDefined();
      expect(result.sections).toBeDefined();
    });

    it('v6 diagnostics include v6 flag', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
      });
      await runtime.boot();
      const diag = runtime.diagnostics;
      expect(diag.v6).toBe(true);
      expect(diag.vocabularySize).toBeDefined();
    });

    it('learn fires agent_end in v6 mode', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
      });
      await runtime.boot();
      // Should not throw
      await runtime.learn('test response');
    });

    it('shutdown works in v6 mode', async () => {
      const flushFn = vi.fn().mockResolvedValue(undefined);
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        logger: { log: vi.fn(), flush: flushFn },
      });
      await runtime.boot();
      await runtime.shutdown();
      expect(flushFn).toHaveBeenCalledOnce();
    });

    it('fire works in v6 mode', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
      });
      await runtime.boot();
      const results = await runtime.fire('custom_event', { data: 1 });
      expect(results).toEqual([]);
    });

    it('fireToolCall works in v6 mode', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
      });
      await runtime.boot();
      const result = await runtime.fireToolCall({ tool: 'test', input: {} });
      expect(result).toBeNull();
    });

    it('commands getter returns empty array when no extensions', async () => {
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
      });
      await runtime.boot();
      expect(runtime.commands).toEqual([]);
    });
  });
});
