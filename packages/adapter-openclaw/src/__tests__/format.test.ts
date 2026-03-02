import { describe, it, expect } from 'vitest';
import { formatContext } from '@dot-ai/core';
import type { EnrichedContext } from '@dot-ai/core';

function makeEmptyContext(): EnrichedContext {
  return {
    prompt: '',
    labels: [],
    identities: [],
    memories: [],
    skills: [],
    tools: [],
    routing: { model: 'default', reason: 'no match' },
  };
}

describe('formatContext', () => {
  it('returns empty string for empty context', () => {
    const ctx = makeEmptyContext();
    expect(formatContext(ctx)).toBe('');
  });

  it('orders identities by priority (highest first)', () => {
    const ctx = makeEmptyContext();
    ctx.identities = [
      { type: 'soul', content: 'Soul content', source: 'file', priority: 1 },
      { type: 'agents', content: 'Agents content', source: 'file', priority: 10 },
      { type: 'user', content: 'User content', source: 'file', priority: 5 },
    ];
    const result = formatContext(ctx);
    const agentsPos = result.indexOf('Agents content');
    const userPos = result.indexOf('User content');
    const soulPos = result.indexOf('Soul content');
    expect(agentsPos).toBeLessThan(userPos);
    expect(userPos).toBeLessThan(soulPos);
  });

  it('skips identities with no content', () => {
    const ctx = makeEmptyContext();
    ctx.identities = [
      { type: 'agents', content: '', source: 'file', priority: 10 },
      { type: 'soul', content: 'Soul content', source: 'file', priority: 1 },
    ];
    const result = formatContext(ctx);
    expect(result).toBe('Soul content');
  });

  it('includes memories section with up to 10 entries', () => {
    const ctx = makeEmptyContext();
    ctx.memories = Array.from({ length: 15 }, (_, i) => ({
      content: `Memory ${i}`,
      type: 'fact',
      source: 'file',
    }));
    const result = formatContext(ctx);
    expect(result).toContain('## Relevant Memory');
    // Only first 10 should appear
    expect(result).toContain('Memory 0');
    expect(result).toContain('Memory 9');
    expect(result).not.toContain('Memory 10');
  });

  it('includes memory date when present', () => {
    const ctx = makeEmptyContext();
    ctx.memories = [{ content: 'A fact', type: 'fact', source: 'file', date: '2026-03-01' }];
    const result = formatContext(ctx);
    expect(result).toContain('A fact (2026-03-01)');
  });

  it('omits memory date when absent', () => {
    const ctx = makeEmptyContext();
    ctx.memories = [{ content: 'A fact', type: 'fact', source: 'file' }];
    const result = formatContext(ctx);
    expect(result).toContain('- A fact');
    expect(result).not.toContain('- A fact (');
  });

  it('includes skills section only for skills with content', () => {
    const ctx = makeEmptyContext();
    ctx.skills = [
      { name: 'skill-with-content', description: 'Has content', labels: [], content: 'Skill body' },
      { name: 'skill-no-content', description: 'No content', labels: [] },
    ];
    const result = formatContext(ctx);
    expect(result).toContain('## Active Skills');
    expect(result).toContain('### skill-with-content');
    expect(result).toContain('Skill body');
    expect(result).not.toContain('### skill-no-content');
  });

  it('omits skills section when no skills have content', () => {
    const ctx = makeEmptyContext();
    ctx.skills = [
      { name: 'skill-a', description: 'No content', labels: [] },
    ];
    const result = formatContext(ctx);
    expect(result).not.toContain('## Active Skills');
  });

  it('includes tools section', () => {
    const ctx = makeEmptyContext();
    ctx.tools = [
      { name: 'my-tool', description: 'Does things', labels: [], config: {}, source: 'file' },
    ];
    const result = formatContext(ctx);
    expect(result).toContain('## Available Tools');
    expect(result).toContain('**my-tool**: Does things');
  });

  it('includes routing section when model is not default', () => {
    const ctx = makeEmptyContext();
    ctx.routing = { model: 'opus', reason: 'complex task' };
    const result = formatContext(ctx);
    expect(result).toContain('## Model Routing');
    expect(result).toContain('**opus**');
    expect(result).toContain('complex task');
  });

  it('omits routing section when model is default', () => {
    const ctx = makeEmptyContext();
    ctx.routing = { model: 'default', reason: 'no match' };
    const result = formatContext(ctx);
    expect(result).not.toContain('## Model Routing');
  });

  it('joins all sections with separator', () => {
    const ctx = makeEmptyContext();
    ctx.identities = [{ type: 'agents', content: 'Identity', source: 'file', priority: 1 }];
    ctx.memories = [{ content: 'Memory', type: 'fact', source: 'file' }];
    ctx.routing = { model: 'sonnet', reason: 'matched' };
    const result = formatContext(ctx);
    expect(result).toContain('\n\n---\n\n');
  });
});
