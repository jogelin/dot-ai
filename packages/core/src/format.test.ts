import { describe, it, expect, vi } from 'vitest';
import { formatContext } from './format.js';
import type { EnrichedContext, BudgetWarning, Skill, MemoryEntry, Identity } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides?: Partial<EnrichedContext>): EnrichedContext {
  return {
    prompt: 'test prompt',
    labels: [],
    identities: [],
    memories: [],
    skills: [],
    tools: [],
    routing: { model: 'default', reason: 'test' },
    ...overrides,
  };
}

function makeSkill(name: string, contentLength: number): Skill {
  return {
    name,
    description: `Skill ${name}`,
    labels: [],
    content: 'x'.repeat(contentLength),
  };
}

function makeMemory(content: string): MemoryEntry {
  return {
    content,
    type: 'fact',
    source: 'test',
  };
}

function makeIdentity(content: string, priority = 10): Identity {
  return {
    type: 'agents',
    content,
    source: 'test',
    priority,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('formatContext budget', () => {
  it('no budget — returns full content', () => {
    const ctx = makeContext({
      skills: [
        makeSkill('skill-a', 100),
        makeSkill('skill-b', 100),
        makeSkill('skill-c', 100),
      ],
    });

    const result = formatContext(ctx);

    expect(result).toContain('skill-a');
    expect(result).toContain('skill-b');
    expect(result).toContain('skill-c');
  });

  it('under budget — no trimming', () => {
    const ctx = makeContext({
      skills: [makeSkill('small-skill', 50)],
    });

    const onBudgetExceeded = vi.fn();
    const result = formatContext(ctx, { tokenBudget: 10000, onBudgetExceeded });

    expect(result).toContain('small-skill');
    expect(onBudgetExceeded).not.toHaveBeenCalled();
  });

  it('over budget — drops skills by reverse order', () => {
    // 5 skills × 1000 chars = ~5000 chars = ~1250 tokens for skills alone
    const ctx = makeContext({
      skills: [
        makeSkill('skill-1', 1000),
        makeSkill('skill-2', 1000),
        makeSkill('skill-3', 1000),
        makeSkill('skill-4', 1000),
        makeSkill('skill-5', 1000),
      ],
    });

    const actions: string[] = [];
    const onBudgetExceeded = vi.fn((w: BudgetWarning) => actions.push(...w.actions));

    formatContext(ctx, { tokenBudget: 500, onBudgetExceeded });

    expect(onBudgetExceeded).toHaveBeenCalled();
    const droppedActions = actions.filter(a => a.startsWith('dropped skill:'));
    expect(droppedActions.length).toBeGreaterThan(0);
  });

  it('over budget — truncates skills when dropping alone is not enough', () => {
    // 2 skills × 5000 chars = ~10000 chars = ~2500 tokens
    // Budget 800 tokens: dropping 1 skill leaves ~1250 tokens (still over)
    // truncating to 2000 chars per skill → ~1000 chars total → ~250 tokens (under)
    const ctx = makeContext({
      skills: [
        makeSkill('big-skill-a', 5000),
        makeSkill('big-skill-b', 5000),
      ],
    });

    const actions: string[] = [];
    const onBudgetExceeded = vi.fn((w: BudgetWarning) => actions.push(...w.actions));

    formatContext(ctx, { tokenBudget: 800, onBudgetExceeded });

    expect(onBudgetExceeded).toHaveBeenCalled();
    const truncatedActions = actions.filter(a => a.includes('truncated'));
    expect(truncatedActions.length).toBeGreaterThan(0);
  });

  it('over budget — drops memories after skills trimmed', () => {
    // 1 tiny skill + 10 memories × 200 chars = ~2000 chars = ~500 tokens
    // Budget low enough to trigger memory trimming after skills are already minimal
    const memories = Array.from({ length: 10 }, (_, i) =>
      makeMemory('m'.repeat(200) + ` entry-${i}`),
    );

    const ctx = makeContext({
      skills: [makeSkill('tiny', 10)],
      memories,
    });

    const actions: string[] = [];
    const onBudgetExceeded = vi.fn((w: BudgetWarning) => actions.push(...w.actions));

    // ~500 token budget: memories alone exceed this, and there's only 1 skill
    // (can't drop it, strategy 1 requires > 1 skill), truncation won't help much
    // strategy 3 (drop old memories) should fire
    formatContext(ctx, { tokenBudget: 100, onBudgetExceeded });

    expect(onBudgetExceeded).toHaveBeenCalled();
    const memoryActions = actions.filter(a => a.includes('memories'));
    expect(memoryActions.length).toBeGreaterThan(0);
    expect(memoryActions[0]).toMatch(/dropped \d+ oldest memories/);
  });

  it('onBudgetExceeded callback receives correct BudgetWarning', () => {
    const ctx = makeContext({
      skills: [
        makeSkill('alpha', 2000),
        makeSkill('beta', 2000),
        makeSkill('gamma', 2000),
      ],
    });

    let capturedWarning: BudgetWarning | undefined;
    const onBudgetExceeded = vi.fn((w: BudgetWarning) => {
      capturedWarning = w;
    });

    formatContext(ctx, { tokenBudget: 200, onBudgetExceeded });

    expect(onBudgetExceeded).toHaveBeenCalledOnce();
    expect(capturedWarning).toBeDefined();
    expect(capturedWarning!.budget).toBe(200);
    expect(typeof capturedWarning!.actual).toBe('number');
    expect(Array.isArray(capturedWarning!.actions)).toBe(true);
    expect(capturedWarning!.actions.length).toBeGreaterThan(0);
  });

  it('budget trimming preserves identity sections', () => {
    const ctx = makeContext({
      identities: [makeIdentity('You are Kiwi. This is your identity.')],
      skills: [
        makeSkill('skill-x', 3000),
        makeSkill('skill-y', 3000),
      ],
    });

    const onBudgetExceeded = vi.fn();
    // Very low budget — forces trimming, but identities must survive
    const result = formatContext(ctx, { tokenBudget: 100, onBudgetExceeded });

    expect(result).toContain('You are Kiwi. This is your identity.');
  });
});
