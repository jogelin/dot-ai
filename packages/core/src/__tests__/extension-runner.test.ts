import { describe, it, expect, vi } from 'vitest';
import { ExtensionRunner, EventBus } from '../extension-runner.js';
import type { LoadedExtension } from '../extension-types.js';

function createMockExtension(overrides?: Partial<LoadedExtension>): LoadedExtension {
  return {
    path: '/mock/ext.ts',
    handlers: new Map(),
    tools: new Map(),
    tiers: new Set(),
    ...overrides,
  };
}

describe('ExtensionRunner', () => {
  describe('fire', () => {
    it('fires events to registered handlers', async () => {
      const handler = vi.fn().mockResolvedValue({ inject: 'hello' });
      const ext = createMockExtension({
        handlers: new Map([['context_inject', [handler]]]),
      });
      const runner = new ExtensionRunner([ext]);
      const results = await runner.fire('context_inject', { prompt: 'test', labels: [] });
      expect(handler).toHaveBeenCalledWith({ prompt: 'test', labels: [] }, undefined);
      expect(results).toEqual([{ inject: 'hello' }]);
    });

    it('collects results from multiple extensions', async () => {
      const ext1 = createMockExtension({
        handlers: new Map([['context_inject', [vi.fn().mockResolvedValue({ inject: 'a' })]]]),
      });
      const ext2 = createMockExtension({
        handlers: new Map([['context_inject', [vi.fn().mockResolvedValue({ inject: 'b' })]]]),
      });
      const runner = new ExtensionRunner([ext1, ext2]);
      const results = await runner.fire('context_inject', {});
      expect(results).toEqual([{ inject: 'a' }, { inject: 'b' }]);
    });

    it('skips void results', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const ext = createMockExtension({
        handlers: new Map([['agent_end', [handler]]]),
      });
      const runner = new ExtensionRunner([ext]);
      const results = await runner.fire('agent_end', { response: 'done' });
      expect(results).toEqual([]);
    });

    it('handles errors in handlers (log and continue)', async () => {
      const goodHandler = vi.fn().mockResolvedValue({ inject: 'ok' });
      const badHandler = vi.fn().mockRejectedValue(new Error('boom'));
      const ext = createMockExtension({
        handlers: new Map([['context_inject', [badHandler, goodHandler]]]),
      });
      const runner = new ExtensionRunner([ext]);
      const results = await runner.fire('context_inject', {});
      expect(results).toEqual([{ inject: 'ok' }]);
    });

    it('passes ctx as second argument to handlers', async () => {
      const handler = vi.fn().mockResolvedValue({ inject: 'with-ctx' });
      const ext = createMockExtension({
        handlers: new Map([['context_inject', [handler]]]),
      });
      const runner = new ExtensionRunner([ext]);
      const ctx = { workspaceRoot: '/test', events: { on: vi.fn(), emit: vi.fn() } };
      await runner.fire('context_inject', { prompt: 'test', labels: [] }, ctx);
      expect(handler).toHaveBeenCalledWith({ prompt: 'test', labels: [] }, ctx);
    });

    it('returns empty array for events with no handlers', async () => {
      const ext = createMockExtension();
      const runner = new ExtensionRunner([ext]);
      const results = await runner.fire('nonexistent', {});
      expect(results).toEqual([]);
    });
  });

  describe('fireUntilBlocked', () => {
    it('stops at first block', async () => {
      const blockHandler = vi.fn().mockResolvedValue({ decision: 'block', reason: 'not allowed' });
      const neverCalled = vi.fn().mockResolvedValue({ decision: 'allow' });
      const ext1 = createMockExtension({
        handlers: new Map([['tool_call', [blockHandler]]]),
      });
      const ext2 = createMockExtension({
        handlers: new Map([['tool_call', [neverCalled]]]),
      });
      const runner = new ExtensionRunner([ext1, ext2]);
      const result = await runner.fireUntilBlocked('tool_call', { tool: 'Write', input: {} });
      expect(result).toEqual({ decision: 'block', reason: 'not allowed' });
      expect(neverCalled).not.toHaveBeenCalled();
    });

    it('returns null when all allow', async () => {
      const allowHandler = vi.fn().mockResolvedValue({ decision: 'allow' });
      const ext = createMockExtension({
        handlers: new Map([['tool_call', [allowHandler]]]),
      });
      const runner = new ExtensionRunner([ext]);
      const result = await runner.fireUntilBlocked('tool_call', { tool: 'Read', input: {} });
      expect(result).toBeNull();
    });

    it('returns null when no handlers', async () => {
      const runner = new ExtensionRunner([createMockExtension()]);
      const result = await runner.fireUntilBlocked('tool_call', { tool: 'Read', input: {} });
      expect(result).toBeNull();
    });

    it('handles errors in handlers', async () => {
      const badHandler = vi.fn().mockRejectedValue(new Error('boom'));
      const ext = createMockExtension({
        handlers: new Map([['tool_call', [badHandler]]]),
      });
      const runner = new ExtensionRunner([ext]);
      const result = await runner.fireUntilBlocked('tool_call', { tool: 'Read', input: {} });
      expect(result).toBeNull();
    });

    it('passes ctx to tool_call handlers', async () => {
      const handler = vi.fn().mockResolvedValue({ decision: 'allow' });
      const ext = createMockExtension({
        handlers: new Map([['tool_call', [handler]]]),
      });
      const runner = new ExtensionRunner([ext]);
      const ctx = { workspaceRoot: '/test', events: { on: vi.fn(), emit: vi.fn() } };
      await runner.fireUntilBlocked('tool_call', { tool: 'Read', input: {} }, ctx);
      expect(handler).toHaveBeenCalledWith({ tool: 'Read', input: {} }, ctx);
    });
  });

  describe('tools', () => {
    it('merges tools across extensions', () => {
      const tool1 = { name: 'tool_a', description: 'A', parameters: {}, execute: vi.fn() };
      const tool2 = { name: 'tool_b', description: 'B', parameters: {}, execute: vi.fn() };
      const ext1 = createMockExtension({ tools: new Map([['tool_a', tool1]]) });
      const ext2 = createMockExtension({ tools: new Map([['tool_b', tool2]]) });
      const runner = new ExtensionRunner([ext1, ext2]);
      expect(runner.tools).toHaveLength(2);
      expect(runner.tools.map(t => t.name)).toEqual(['tool_a', 'tool_b']);
    });

    it('last-wins for duplicate tool names (override)', () => {
      const tool1 = { name: 'dup', description: 'A', parameters: {}, execute: vi.fn() };
      const tool2 = { name: 'dup', description: 'B', parameters: {}, execute: vi.fn() };
      const ext1 = createMockExtension({ tools: new Map([['dup', tool1]]) });
      const ext2 = createMockExtension({ tools: new Map([['dup', tool2]]) });
      const logger = { log: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
      const runner = new ExtensionRunner([ext1, ext2], logger);
      const tools = runner.tools;
      expect(tools).toHaveLength(1);
      expect(tools[0].description).toBe('B'); // last wins
      expect(logger.log).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'tool_override' }),
      );
    });
  });

  describe('diagnostics', () => {
    it('reports correct counts and tiers', () => {
      const ext = createMockExtension({
        path: '/ext/test.ts',
        handlers: new Map([
          ['context_inject', [vi.fn(), vi.fn()]],
          ['tool_call', [vi.fn()]],
        ]),
        tools: new Map([['my_tool', { name: 'my_tool', description: '', parameters: {}, execute: vi.fn() }]]),
        tiers: new Set(['universal'] as const),
      });
      const runner = new ExtensionRunner([ext]);
      const diag = runner.diagnostics;
      expect(diag).toHaveLength(1);
      expect(diag[0].path).toBe('/ext/test.ts');
      expect(diag[0].handlerCounts).toEqual({ context_inject: 2, tool_call: 1 });
      expect(diag[0].toolNames).toEqual(['my_tool']);
      expect(diag[0].tiers).toEqual(['universal']);
    });
  });

  describe('usedTiers', () => {
    it('aggregates tiers from all extensions', () => {
      const ext1 = createMockExtension({ tiers: new Set(['universal'] as const) });
      const ext2 = createMockExtension({ tiers: new Set(['rich'] as const) });
      const runner = new ExtensionRunner([ext1, ext2]);
      expect(runner.usedTiers).toEqual(new Set(['universal', 'rich']));
    });
  });
});

describe('EventBus', () => {
  it('calls registered handlers', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('test', handler);
    bus.emit('test', 'arg1', 'arg2');
    expect(handler).toHaveBeenCalledWith('arg1', 'arg2');
  });

  it('handles errors in handlers silently', () => {
    const bus = new EventBus();
    bus.on('test', () => { throw new Error('boom'); });
    const good = vi.fn();
    bus.on('test', good);
    bus.emit('test');
    expect(good).toHaveBeenCalled();
  });

  it('does nothing for events with no listeners', () => {
    const bus = new EventBus();
    expect(() => bus.emit('nonexistent')).not.toThrow();
  });

  it('removes handler with off()', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('test', handler);
    bus.off('test', handler);
    bus.emit('test');
    expect(handler).not.toHaveBeenCalled();
  });

  it('off() does nothing for non-existent event', () => {
    const bus = new EventBus();
    expect(() => bus.off('nope', vi.fn())).not.toThrow();
  });
});
