import { describe, it, expect, vi } from 'vitest';
import { ExtensionRunner, EventBus } from '../extension-runner.js';
import type { LoadedExtension } from '../extension-types.js';

function createMockExtension(overrides?: Partial<LoadedExtension>): LoadedExtension {
  return {
    path: '/mock/ext.ts',
    handlers: new Map(),
    tools: new Map(),
    commands: new Map(),
    skills: new Map(),
    identities: new Map(),
    labels: new Set(),
    ...overrides,
  };
}

describe('ExtensionRunner', () => {
  describe('fire', () => {
    it('fires events to registered handlers', async () => {
      const handler = vi.fn().mockResolvedValue({ data: 'hello' });
      const ext = createMockExtension({
        handlers: new Map([['agent_end', [handler]]]),
      });
      const runner = new ExtensionRunner([ext]);
      const results = await runner.fire('agent_end', { response: 'test' });
      expect(handler).toHaveBeenCalledWith({ response: 'test' }, undefined);
      expect(results).toEqual([{ data: 'hello' }]);
    });

    it('collects results from multiple extensions', async () => {
      const ext1 = createMockExtension({
        handlers: new Map([['agent_end', [vi.fn().mockResolvedValue({ data: 'a' })]]]),
      });
      const ext2 = createMockExtension({
        handlers: new Map([['agent_end', [vi.fn().mockResolvedValue({ data: 'b' })]]]),
      });
      const runner = new ExtensionRunner([ext1, ext2]);
      const results = await runner.fire('agent_end', {});
      expect(results).toEqual([{ data: 'a' }, { data: 'b' }]);
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
      const goodHandler = vi.fn().mockResolvedValue({ data: 'ok' });
      const badHandler = vi.fn().mockRejectedValue(new Error('boom'));
      const ext = createMockExtension({
        handlers: new Map([['agent_end', [badHandler, goodHandler]]]),
      });
      const runner = new ExtensionRunner([ext]);
      const results = await runner.fire('agent_end', {});
      expect(results).toEqual([{ data: 'ok' }]);
    });

    it('passes ctx as second argument to handlers', async () => {
      const handler = vi.fn().mockResolvedValue({ data: 'with-ctx' });
      const ext = createMockExtension({
        handlers: new Map([['agent_end', [handler]]]),
      });
      const runner = new ExtensionRunner([ext]);
      const ctx = { workspaceRoot: '/test', events: { on: vi.fn(), emit: vi.fn() } };
      await runner.fire('agent_end', { response: 'test' }, ctx);
      expect(handler).toHaveBeenCalledWith({ response: 'test' }, ctx);
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

  describe('skills', () => {
    it('merges skills across extensions', () => {
      const skill1 = { name: 'deploy', description: 'Deploy', labels: ['deploy'], content: '...' };
      const skill2 = { name: 'security', description: 'Security', labels: ['security'], content: '...' };
      const ext1 = createMockExtension({ skills: new Map([['deploy', skill1]]) });
      const ext2 = createMockExtension({ skills: new Map([['security', skill2]]) });
      const runner = new ExtensionRunner([ext1, ext2]);
      expect(runner.skills).toHaveLength(2);
      expect(runner.skills.map(s => s.name)).toEqual(['deploy', 'security']);
    });
  });

  describe('identities', () => {
    it('merges identities across extensions', () => {
      const id1 = { type: 'agents', content: '# AGENTS', source: 'ext-file-identity', priority: 100 };
      const ext1 = createMockExtension({ identities: new Map([['agents:root', id1]]) });
      const runner = new ExtensionRunner([ext1]);
      expect(runner.identities).toHaveLength(1);
      expect(runner.identities[0].type).toBe('agents');
    });
  });

  describe('vocabularyLabels', () => {
    it('collects labels from all extensions', () => {
      const ext1 = createMockExtension({ labels: new Set(['deploy', 'security']) });
      const ext2 = createMockExtension({ labels: new Set(['question', 'deploy']) });
      const runner = new ExtensionRunner([ext1, ext2]);
      const labels = runner.vocabularyLabels;
      expect(labels).toContain('deploy');
      expect(labels).toContain('security');
      expect(labels).toContain('question');
      // No duplicates
      expect(labels.filter(l => l === 'deploy')).toHaveLength(1);
    });
  });

  describe('fireCollectSections', () => {
    it('collects sections from multiple handlers', async () => {
      const handler1 = vi.fn().mockResolvedValue({
        sections: [{ id: 'sec-a', content: 'A' }],
      });
      const handler2 = vi.fn().mockResolvedValue({
        sections: [{ id: 'sec-b', content: 'B' }],
      });
      const ext1 = createMockExtension({ handlers: new Map([['context_enrich', [handler1]]]) });
      const ext2 = createMockExtension({ handlers: new Map([['context_enrich', [handler2]]]) });
      const runner = new ExtensionRunner([ext1, ext2]);
      const result = await runner.fireCollectSections('context_enrich');
      expect(result.sections).toHaveLength(2);
      const ids = result.sections.map((s: { id?: string }) => s.id);
      expect(ids).toContain('sec-a');
      expect(ids).toContain('sec-b');
    });

    it('deduplicates sections by id (last-wins)', async () => {
      const handler1 = vi.fn().mockResolvedValue({
        sections: [{ id: 'shared', content: 'first' }],
      });
      const handler2 = vi.fn().mockResolvedValue({
        sections: [{ id: 'shared', content: 'last' }],
      });
      const ext1 = createMockExtension({ handlers: new Map([['context_enrich', [handler1]]]) });
      const ext2 = createMockExtension({ handlers: new Map([['context_enrich', [handler2]]]) });
      const runner = new ExtensionRunner([ext1, ext2]);
      const result = await runner.fireCollectSections('context_enrich');
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].content).toBe('last');
    });

    it('keeps anonymous sections (no id)', async () => {
      const handler1 = vi.fn().mockResolvedValue({
        sections: [{ content: 'anon-1' }],
      });
      const handler2 = vi.fn().mockResolvedValue({
        sections: [{ content: 'anon-2' }],
      });
      const ext1 = createMockExtension({ handlers: new Map([['context_enrich', [handler1]]]) });
      const ext2 = createMockExtension({ handlers: new Map([['context_enrich', [handler2]]]) });
      const runner = new ExtensionRunner([ext1, ext2]);
      const result = await runner.fireCollectSections('context_enrich');
      expect(result.sections).toHaveLength(2);
      const contents = result.sections.map((s: { content: string }) => s.content);
      expect(contents).toContain('anon-1');
      expect(contents).toContain('anon-2');
    });

    it('concatenates systemPrompt strings', async () => {
      const handler1 = vi.fn().mockResolvedValue({ systemPrompt: 'You are helpful.' });
      const handler2 = vi.fn().mockResolvedValue({ systemPrompt: 'Be concise.' });
      const ext1 = createMockExtension({ handlers: new Map([['context_enrich', [handler1]]]) });
      const ext2 = createMockExtension({ handlers: new Map([['context_enrich', [handler2]]]) });
      const runner = new ExtensionRunner([ext1, ext2]);
      const result = await runner.fireCollectSections('context_enrich');
      expect(result.systemPrompt).toBe('You are helpful.\nBe concise.');
    });

    it('returns empty sections array and empty systemPrompt when no handlers', async () => {
      const runner = new ExtensionRunner([createMockExtension()]);
      const result = await runner.fireCollectSections('context_enrich');
      expect(result.sections).toEqual([]);
      expect(result.systemPrompt).toBe('');
    });

    it('handles handler errors gracefully', async () => {
      const badHandler = vi.fn().mockRejectedValue(new Error('boom'));
      const goodHandler = vi.fn().mockResolvedValue({
        sections: [{ id: 'ok', content: 'good' }],
      });
      const ext = createMockExtension({
        handlers: new Map([['context_enrich', [badHandler, goodHandler]]]),
      });
      const runner = new ExtensionRunner([ext]);
      const result = await runner.fireCollectSections('context_enrich');
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].id).toBe('ok');
    });
  });

  describe('fireFirstResult', () => {
    it('returns first non-null result', async () => {
      const handler = vi.fn().mockResolvedValue({ route: 'chat' });
      const ext = createMockExtension({ handlers: new Map([['route', [handler]]]) });
      const runner = new ExtensionRunner([ext]);
      const result = await runner.fireFirstResult('route', { message: 'hi' });
      expect(result).toEqual({ route: 'chat' });
    });

    it('stops after first result (second handler not called)', async () => {
      const handler1 = vi.fn().mockResolvedValue({ route: 'first' });
      const handler2 = vi.fn().mockResolvedValue({ route: 'second' });
      const ext1 = createMockExtension({ handlers: new Map([['route', [handler1]]]) });
      const ext2 = createMockExtension({ handlers: new Map([['route', [handler2]]]) });
      const runner = new ExtensionRunner([ext1, ext2]);
      const result = await runner.fireFirstResult('route', {});
      expect(result).toEqual({ route: 'first' });
      expect(handler2).not.toHaveBeenCalled();
    });

    it('returns null when no handler returns a value', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const ext = createMockExtension({ handlers: new Map([['route', [handler]]]) });
      const runner = new ExtensionRunner([ext]);
      const result = await runner.fireFirstResult('route', {});
      expect(result).toBeNull();
    });

    it('skips null/undefined results and returns next non-null', async () => {
      const handler1 = vi.fn().mockResolvedValue(null);
      const handler2 = vi.fn().mockResolvedValue(undefined);
      const handler3 = vi.fn().mockResolvedValue({ route: 'found' });
      const ext = createMockExtension({
        handlers: new Map([['route', [handler1, handler2, handler3]]]),
      });
      const runner = new ExtensionRunner([ext]);
      const result = await runner.fireFirstResult('route', {});
      expect(result).toEqual({ route: 'found' });
    });
  });

  describe('fireChainTransform', () => {
    it('chains transform through handlers', async () => {
      const handler1 = vi.fn().mockImplementation(async (data: { value: number }) => ({
        value: data.value + 1,
      }));
      const handler2 = vi.fn().mockImplementation(async (data: { value: number }) => ({
        value: data.value * 2,
      }));
      const ext = createMockExtension({
        handlers: new Map([['label_extract', [handler1, handler2]]]),
      });
      const runner = new ExtensionRunner([ext]);
      const result = await runner.fireChainTransform('label_extract', { value: 3 });
      // (3 + 1) * 2 = 8
      expect(result).toEqual({ value: 8 });
    });

    it('keeps previous value when handler returns undefined', async () => {
      const handler1 = vi.fn().mockResolvedValue({ value: 42 });
      const handler2 = vi.fn().mockResolvedValue(undefined);
      const ext = createMockExtension({
        handlers: new Map([['label_extract', [handler1, handler2]]]),
      });
      const runner = new ExtensionRunner([ext]);
      const result = await runner.fireChainTransform('label_extract', { value: 0 });
      expect(result).toEqual({ value: 42 });
    });

    it('short-circuits on input event with consumed: true', async () => {
      const handler1 = vi.fn().mockResolvedValue({ text: 'consumed', consumed: true });
      const handler2 = vi.fn().mockResolvedValue({ text: 'never' });
      const ext = createMockExtension({
        handlers: new Map([['input', [handler1, handler2]]]),
      });
      const runner = new ExtensionRunner([ext]);
      const result = await runner.fireChainTransform('input', { text: 'original' });
      expect(result).toEqual({ text: 'consumed', consumed: true });
      expect(handler2).not.toHaveBeenCalled();
    });

    it('handles single handler', async () => {
      const handler = vi.fn().mockResolvedValue({ label: 'question' });
      const ext = createMockExtension({
        handlers: new Map([['label_extract', [handler]]]),
      });
      const runner = new ExtensionRunner([ext]);
      const result = await runner.fireChainTransform('label_extract', { label: 'unknown' });
      expect(result).toEqual({ label: 'question' });
    });

    it('returns initial data when no handlers', async () => {
      const runner = new ExtensionRunner([createMockExtension()]);
      const initial = { value: 99 };
      const result = await runner.fireChainTransform('label_extract', initial);
      expect(result).toEqual({ value: 99 });
    });
  });

  describe('diagnostics', () => {
    it('reports correct counts', () => {
      const ext = createMockExtension({
        path: '/ext/test.ts',
        handlers: new Map([
          ['context_enrich', [vi.fn(), vi.fn()]],
          ['tool_call', [vi.fn()]],
        ]),
        tools: new Map([['my_tool', { name: 'my_tool', description: '', parameters: {}, execute: vi.fn() }]]),
        skills: new Map([['deploy', { name: 'deploy', description: '', labels: [] }]]),
        identities: new Map([['agents:root', { type: 'agents', content: '', source: '', priority: 100 }]]),
      });
      const runner = new ExtensionRunner([ext]);
      const diag = runner.diagnostics;
      expect(diag).toHaveLength(1);
      expect(diag[0].path).toBe('/ext/test.ts');
      expect(diag[0].handlerCounts).toEqual({ context_enrich: 2, tool_call: 1 });
      expect(diag[0].toolNames).toEqual(['my_tool']);
      expect(diag[0].skillNames).toEqual(['deploy']);
      expect(diag[0].identityNames).toEqual(['agents:root']);
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
