import { describe, it, expect, vi } from 'vitest';
import { loadHooks, runAfterBoot, runAfterEnrich, runAfterFormat, runAfterLearn } from '../hooks.js';
import type { ResolvedHook, HookEvent } from '../hooks.js';
import type { BootCache } from '../engine.js';
import type { EnrichedContext } from '../types.js';

// --- Helpers ---

function makeResolvedHook(
  event: HookEvent,
  handler: ResolvedHook['handler'],
  source = 'test-source',
): ResolvedHook {
  return { event, handler, source };
}

function makeBootCache(): BootCache {
  return { identities: [], vocabulary: [], skills: [] };
}

function makeEnrichedContext(overrides?: Partial<EnrichedContext>): EnrichedContext {
  return {
    prompt: 'test prompt',
    labels: [],
    identities: [],
    memories: [],
    skills: [],
    tools: [],
    routing: { model: 'sonnet', reason: 'default' },
    ...overrides,
  };
}

// --- loadHooks ---

describe('loadHooks', () => {
  it('returns empty array when config is undefined', async () => {
    const result = await loadHooks(undefined);
    expect(result).toEqual([]);
  });

  it('returns empty array when config has no entries', async () => {
    const result = await loadHooks({});
    expect(result).toEqual([]);
  });
});

// --- runAfterBoot ---

describe('runAfterBoot', () => {
  it('calls matching after_boot hooks sequentially', async () => {
    const callOrder: number[] = [];
    const handler1 = vi.fn(async () => { callOrder.push(1); });
    const handler2 = vi.fn(async () => { callOrder.push(2); });

    const hooks: ResolvedHook[] = [
      makeResolvedHook('after_boot', handler1),
      makeResolvedHook('after_boot', handler2),
    ];

    const cache = makeBootCache();
    await runAfterBoot(hooks, cache);

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler1).toHaveBeenCalledWith(cache);
    expect(handler2).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledWith(cache);
    expect(callOrder).toEqual([1, 2]);
  });

  it('ignores hooks for other events', async () => {
    const handler = vi.fn(async () => {});
    const hooks: ResolvedHook[] = [
      makeResolvedHook('after_enrich', handler as ResolvedHook['handler']),
    ];

    await runAfterBoot(hooks, makeBootCache());

    expect(handler).not.toHaveBeenCalled();
  });

  it('catches and swallows handler errors, second hook still runs', async () => {
    const throwingHandler = vi.fn(async () => { throw new Error('boom'); });
    const secondHandler = vi.fn(async () => {});

    const hooks: ResolvedHook[] = [
      makeResolvedHook('after_boot', throwingHandler),
      makeResolvedHook('after_boot', secondHandler),
    ];

    await expect(runAfterBoot(hooks, makeBootCache())).resolves.toBeUndefined();
    expect(throwingHandler).toHaveBeenCalledOnce();
    expect(secondHandler).toHaveBeenCalledOnce();
  });
});

// --- runAfterEnrich ---

describe('runAfterEnrich', () => {
  it('returns original context when no hooks match', async () => {
    const ctx = makeEnrichedContext();
    const result = await runAfterEnrich([], ctx);
    expect(result).toBe(ctx);
  });

  it('passes context through sequentially — hook 1 adds a label, hook 2 reads it', async () => {
    const hook1 = vi.fn(async (ctx: EnrichedContext): Promise<EnrichedContext> => ({
      ...ctx,
      labels: [...ctx.labels, { name: 'added-by-hook1', source: 'hook1' }],
    }));
    const hook2 = vi.fn(async (ctx: EnrichedContext): Promise<void> => {
      expect(ctx.labels.some((l) => l.name === 'added-by-hook1')).toBe(true);
    });

    const hooks: ResolvedHook[] = [
      makeResolvedHook('after_enrich', hook1 as ResolvedHook['handler']),
      makeResolvedHook('after_enrich', hook2 as ResolvedHook['handler']),
    ];

    await runAfterEnrich(hooks, makeEnrichedContext());
    expect(hook1).toHaveBeenCalledOnce();
    expect(hook2).toHaveBeenCalledOnce();
  });

  it('replaces context when hook returns a value', async () => {
    const newCtx = makeEnrichedContext({ prompt: 'replaced' });
    const handler = vi.fn(async (): Promise<EnrichedContext> => newCtx);

    const hooks: ResolvedHook[] = [
      makeResolvedHook('after_enrich', handler as ResolvedHook['handler']),
    ];

    const result = await runAfterEnrich(hooks, makeEnrichedContext({ prompt: 'original' }));
    expect(result).toBe(newCtx);
    expect(result.prompt).toBe('replaced');
  });

  it('preserves context when hook returns void', async () => {
    const original = makeEnrichedContext({ prompt: 'original' });
    const handler = vi.fn(async (): Promise<void> => {});

    const hooks: ResolvedHook[] = [
      makeResolvedHook('after_enrich', handler as ResolvedHook['handler']),
    ];

    const result = await runAfterEnrich(hooks, original);
    expect(result).toBe(original);
  });

  it('catches errors and continues with current context', async () => {
    const original = makeEnrichedContext({ prompt: 'original' });
    const throwingHandler = vi.fn(async (): Promise<EnrichedContext> => {
      throw new Error('enrich error');
    });
    const secondHandler = vi.fn(async (ctx: EnrichedContext): Promise<void> => {
      expect(ctx).toBe(original);
    });

    const hooks: ResolvedHook[] = [
      makeResolvedHook('after_enrich', throwingHandler as ResolvedHook['handler']),
      makeResolvedHook('after_enrich', secondHandler as ResolvedHook['handler']),
    ];

    const result = await runAfterEnrich(hooks, original);
    expect(result).toBe(original);
    expect(throwingHandler).toHaveBeenCalledOnce();
    expect(secondHandler).toHaveBeenCalledOnce();
  });
});

// --- runAfterFormat ---

describe('runAfterFormat', () => {
  it('returns original string when no hooks match', async () => {
    const result = await runAfterFormat([], 'original output', makeEnrichedContext());
    expect(result).toBe('original output');
  });

  it('replaces string when hook returns a value', async () => {
    const handler = vi.fn(async (formatted: string): Promise<string> =>
      formatted + '\n## Custom',
    );

    const hooks: ResolvedHook[] = [
      makeResolvedHook('after_format', handler as ResolvedHook['handler']),
    ];

    const result = await runAfterFormat(hooks, 'base', makeEnrichedContext());
    expect(result).toBe('base\n## Custom');
  });

  it('chains multiple hooks', async () => {
    const hook1 = vi.fn(async (s: string): Promise<string> => s + 'A');
    const hook2 = vi.fn(async (s: string): Promise<string> => s + 'B');

    const hooks: ResolvedHook[] = [
      makeResolvedHook('after_format', hook1 as ResolvedHook['handler']),
      makeResolvedHook('after_format', hook2 as ResolvedHook['handler']),
    ];

    const result = await runAfterFormat(hooks, 'base', makeEnrichedContext());
    expect(result).toContain('A');
    expect(result).toContain('B');
    expect(result).toBe('baseAB');
  });

  it('catches errors and continues', async () => {
    const throwingHandler = vi.fn(async (): Promise<string> => {
      throw new Error('format error');
    });
    const secondHandler = vi.fn(async (s: string): Promise<string> => s + '-ok');

    const hooks: ResolvedHook[] = [
      makeResolvedHook('after_format', throwingHandler as ResolvedHook['handler']),
      makeResolvedHook('after_format', secondHandler as ResolvedHook['handler']),
    ];

    const result = await runAfterFormat(hooks, 'base', makeEnrichedContext());
    expect(result).toBe('base-ok');
    expect(throwingHandler).toHaveBeenCalledOnce();
    expect(secondHandler).toHaveBeenCalledOnce();
  });
});

// --- runAfterLearn ---

describe('runAfterLearn', () => {
  it('calls matching hooks with response', async () => {
    const handler = vi.fn(async (_response: string): Promise<void> => {});

    const hooks: ResolvedHook[] = [
      makeResolvedHook('after_learn', handler as ResolvedHook['handler']),
    ];

    await runAfterLearn(hooks, 'the response');
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith('the response');
  });

  it('catches errors and continues', async () => {
    const throwingHandler = vi.fn(async (): Promise<void> => {
      throw new Error('learn error');
    });
    const secondHandler = vi.fn(async (): Promise<void> => {});

    const hooks: ResolvedHook[] = [
      makeResolvedHook('after_learn', throwingHandler as ResolvedHook['handler']),
      makeResolvedHook('after_learn', secondHandler as ResolvedHook['handler']),
    ];

    await expect(runAfterLearn(hooks, 'response')).resolves.toBeUndefined();
    expect(throwingHandler).toHaveBeenCalledOnce();
    expect(secondHandler).toHaveBeenCalledOnce();
  });
});
