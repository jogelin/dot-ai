import { describe, it, expect, vi } from 'vitest';
import { DotAiRuntime } from '../runtime.js';

describe('DotAiRuntime', () => {
  describe('boot', () => {
    it('boots and is idempotent', async () => {
      const runtime = new DotAiRuntime({ workspaceRoot: '/tmp/nonexistent' });
      await runtime.boot();
      expect(runtime.isBooted).toBe(true);
      // Second boot is a no-op
      await runtime.boot();
      expect(runtime.isBooted).toBe(true);
    });

    it('isBooted is false before boot', () => {
      const runtime = new DotAiRuntime({ workspaceRoot: '/tmp/nonexistent' });
      expect(runtime.isBooted).toBe(false);
    });

    it('auto-boots on processPrompt', async () => {
      const runtime = new DotAiRuntime({ workspaceRoot: '/tmp/nonexistent' });
      expect(runtime.isBooted).toBe(false);
      await runtime.processPrompt('hello');
      expect(runtime.isBooted).toBe(true);
    });
  });

  describe('processPrompt', () => {
    it('returns sections, labels, routing', async () => {
      const runtime = new DotAiRuntime({ workspaceRoot: '/tmp/nonexistent' });
      await runtime.boot();
      const result = await runtime.processPrompt('hello world');
      expect(result.labels).toBeDefined();
      expect(result.sections).toBeDefined();
      expect(Array.isArray(result.sections)).toBe(true);
      expect(result.routing).toBeDefined();
    });

    it('includes core system section', async () => {
      const runtime = new DotAiRuntime({ workspaceRoot: '/tmp/nonexistent' });
      await runtime.boot();
      const result = await runtime.processPrompt('hello');
      const systemSection = result.sections.find(s => s.id === 'dot-ai:system');
      expect(systemSection).toBeDefined();
      expect(systemSection!.priority).toBe(95);
      expect(systemSection!.source).toBe('core');
    });
  });

  describe('event firing', () => {
    it('fire returns empty when not booted', async () => {
      const runtime = new DotAiRuntime({ workspaceRoot: '/tmp/nonexistent' });
      const results = await runtime.fire('any');
      expect(results).toEqual([]);
    });

    it('fire returns empty with no extensions', async () => {
      const runtime = new DotAiRuntime({ workspaceRoot: '/tmp/nonexistent' });
      await runtime.boot();
      const results = await runtime.fire('custom_event', { data: 1 });
      expect(results).toEqual([]);
    });

    it('fireToolCall returns null when not booted', async () => {
      const runtime = new DotAiRuntime({ workspaceRoot: '/tmp/nonexistent' });
      const result = await runtime.fireToolCall({ tool: 'test', input: {} });
      expect(result).toBeNull();
    });

    it('fireToolCall returns null with no extensions', async () => {
      const runtime = new DotAiRuntime({ workspaceRoot: '/tmp/nonexistent' });
      await runtime.boot();
      const result = await runtime.fireToolCall({ tool: 'test', input: {} });
      expect(result).toBeNull();
    });
  });

  describe('executeTool', () => {
    it('throws when not booted', async () => {
      const runtime = new DotAiRuntime({ workspaceRoot: '/tmp/nonexistent' });
      await expect(runtime.executeTool('test', {})).rejects.toThrow('Runtime not booted');
    });

    it('throws for unknown tool', async () => {
      const runtime = new DotAiRuntime({ workspaceRoot: '/tmp/nonexistent' });
      await runtime.boot();
      await expect(runtime.executeTool('nonexistent', {})).rejects.toThrow('Tool not found');
    });
  });

  describe('shutdown', () => {
    it('fires session_end and flushes', async () => {
      const flushFn = vi.fn().mockResolvedValue(undefined);
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        logger: { log: vi.fn(), flush: flushFn },
      });
      await runtime.boot();
      await runtime.shutdown();
      expect(flushFn).toHaveBeenCalledOnce();
    });

    it('works without boot', async () => {
      const flushFn = vi.fn().mockResolvedValue(undefined);
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        logger: { log: vi.fn(), flush: flushFn },
      });
      await runtime.shutdown();
      expect(flushFn).toHaveBeenCalledOnce();
    });
  });

  describe('flush', () => {
    it('flushes logger', async () => {
      const flushFn = vi.fn().mockResolvedValue(undefined);
      const runtime = new DotAiRuntime({
        workspaceRoot: '/tmp/nonexistent',
        logger: { log: vi.fn(), flush: flushFn },
      });
      await runtime.flush();
      expect(flushFn).toHaveBeenCalledOnce();
    });
  });

  describe('accessors', () => {
    it('runner is available after boot', async () => {
      const runtime = new DotAiRuntime({ workspaceRoot: '/tmp/nonexistent' });
      await runtime.boot();
      expect(runtime.runner).not.toBeNull();
    });

    it('commands returns empty array when no extensions', async () => {
      const runtime = new DotAiRuntime({ workspaceRoot: '/tmp/nonexistent' });
      await runtime.boot();
      expect(runtime.commands).toEqual([]);
    });

    it('skills returns empty array when no extensions', async () => {
      const runtime = new DotAiRuntime({ workspaceRoot: '/tmp/nonexistent' });
      await runtime.boot();
      expect(runtime.skills).toEqual([]);
    });

    it('identities returns empty array when no extensions', async () => {
      const runtime = new DotAiRuntime({ workspaceRoot: '/tmp/nonexistent' });
      await runtime.boot();
      expect(runtime.identities).toEqual([]);
    });

    it('diagnostics include vocabulary size and counts', async () => {
      const runtime = new DotAiRuntime({ workspaceRoot: '/tmp/nonexistent' });
      await runtime.boot();
      const diag = runtime.diagnostics;
      expect(diag.vocabularySize).toBeDefined();
      expect(diag.capabilityCount).toBe(0);
      expect(diag.skillCount).toBe(0);
      expect(diag.identityCount).toBe(0);
      expect(diag.extensions).toEqual([]);
    });

    it('diagnostics before boot', () => {
      const runtime = new DotAiRuntime({ workspaceRoot: '/tmp/nonexistent' });
      const diag = runtime.diagnostics;
      expect(diag.extensions).toEqual([]);
      expect(diag.capabilityCount).toBe(0);
    });
  });
});
