import { describe, it, expect } from 'vitest';
import { formatContext } from '@dot-ai/core';
import type { EnrichedContext } from '@dot-ai/core';

function makeCtx(overrides: Partial<EnrichedContext> = {}): EnrichedContext {
  return {
    prompt: 'test prompt',
    labels: [],
    identities: [],
    memories: [],
    skills: [],
    tools: [],
    routing: { model: 'default', reason: 'no routing' },
    ...overrides,
  };
}

describe('formatContext', () => {
  it('returns empty string when nothing to format', () => {
    const result = formatContext(makeCtx());
    expect(result).toBe('');
  });

  it('formats identities only', () => {
    const ctx = makeCtx({
      identities: [
        { type: 'agents', content: '# AGENTS\nRules here', source: 'file', priority: 10 },
      ],
    });
    const result = formatContext(ctx);
    expect(result).toBe('# AGENTS\nRules here');
  });

  it('formats memories section', () => {
    const ctx = makeCtx({
      memories: [
        { content: 'User prefers TypeScript', type: 'fact', source: 'file' },
        { content: 'Project uses pnpm', type: 'fact', source: 'file', date: '2026-01-01' },
      ],
    });
    const result = formatContext(ctx);
    expect(result).toContain('## Relevant Memory');
    expect(result).toContain('- User prefers TypeScript');
    expect(result).toContain('- Project uses pnpm (2026-01-01)');
  });

  it('formats skills with content', () => {
    const ctx = makeCtx({
      skills: [
        { name: 'dot-ai', description: 'Main skill', labels: [], content: '# dot-ai skill\nDo this.' },
      ],
    });
    const result = formatContext(ctx);
    expect(result).toContain('## Active Skills');
    expect(result).toContain('### dot-ai');
    expect(result).toContain('# dot-ai skill\nDo this.');
  });

  it('skips skills without content', () => {
    const ctx = makeCtx({
      skills: [
        { name: 'no-content', description: 'No content skill', labels: [] },
      ],
    });
    const result = formatContext(ctx);
    expect(result).not.toContain('## Active Skills');
    expect(result).not.toContain('### no-content');
  });

  it('formats tools section', () => {
    const ctx = makeCtx({
      tools: [
        { name: 'cockpit', description: 'Task manager', labels: [], config: {}, source: 'file' },
      ],
    });
    const result = formatContext(ctx);
    expect(result).toContain('## Available Tools');
    expect(result).toContain('- **cockpit**: Task manager');
  });

  it('formats routing hint when model is not default', () => {
    const ctx = makeCtx({
      routing: { model: 'haiku', reason: 'simple task' },
    });
    const result = formatContext(ctx);
    expect(result).toContain('## Model Routing');
    expect(result).toContain('**haiku**');
    expect(result).toContain('simple task');
  });

  it('omits routing hint when model is default', () => {
    const ctx = makeCtx({
      routing: { model: 'default', reason: 'no routing' },
    });
    const result = formatContext(ctx);
    expect(result).not.toContain('## Model Routing');
  });

  it('combines all sections with separator', () => {
    const ctx = makeCtx({
      identities: [
        { type: 'soul', content: 'Soul content', source: 'file', priority: 5 },
      ],
      memories: [
        { content: 'A memory', type: 'fact', source: 'file' },
      ],
      skills: [
        { name: 'my-skill', description: 'desc', labels: [], content: 'Skill content' },
      ],
      tools: [
        { name: 'my-tool', description: 'desc', labels: [], config: {}, source: 'file' },
      ],
      routing: { model: 'sonnet', reason: 'dev task' },
    });
    const result = formatContext(ctx);
    // Should contain all sections separated by ---
    expect(result).toContain('Soul content');
    expect(result).toContain('## Relevant Memory');
    expect(result).toContain('## Active Skills');
    expect(result).toContain('## Available Tools');
    expect(result).toContain('## Model Routing');
    // Sections separated by ---
    const separatorCount = (result.match(/\n\n---\n\n/g) ?? []).length;
    expect(separatorCount).toBe(4); // 5 sections = 4 separators
  });

  it('orders identities by priority (highest first)', () => {
    const ctx = makeCtx({
      identities: [
        { type: 'soul', content: 'Low priority', source: 'file', priority: 1 },
        { type: 'agents', content: 'High priority', source: 'file', priority: 100 },
        { type: 'user', content: 'Mid priority', source: 'file', priority: 50 },
      ],
    });
    const result = formatContext(ctx);
    const highIdx = result.indexOf('High priority');
    const midIdx = result.indexOf('Mid priority');
    const lowIdx = result.indexOf('Low priority');
    expect(highIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(lowIdx);
  });

  it('limits memories to 10 entries', () => {
    const memories = Array.from({ length: 15 }, (_, i) => ({
      content: `Memory ${i}`,
      type: 'fact',
      source: 'file',
    }));
    const ctx = makeCtx({ memories });
    const result = formatContext(ctx);
    // Should have entries 0-9 but not 10-14
    expect(result).toContain('Memory 9');
    expect(result).not.toContain('Memory 10');
  });
});
