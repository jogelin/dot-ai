import { describe, it, expect } from 'vitest';
import { formatContext } from './format.js';
import type { EnrichedContext } from './types.js';

function makeContext(overrides: Partial<EnrichedContext> = {}): EnrichedContext {
  return {
    prompt: 'test',
    labels: [],
    identities: [],
    memories: [],
    skills: [],
    tools: [],
    routing: { model: 'default', reason: 'test' },
    ...overrides,
  };
}

describe('formatContext — memoryDescription', () => {
  it('includes blockquote description before memory entries when both memories and memoryDescription are present', () => {
    const ctx = makeContext({
      memoryDescription: 'SQLite memory (FTS5). 42 entries.',
      memories: [
        { content: 'User prefers TypeScript', type: 'fact', source: 'sqlite-memory' },
      ],
    });

    const result = formatContext(ctx);

    expect(result).toContain('> SQLite memory (FTS5). 42 entries.');
    expect(result).toContain('User prefers TypeScript');
    // description comes before entries
    expect(result.indexOf('> SQLite memory')).toBeLessThan(result.indexOf('User prefers TypeScript'));
  });

  it('does not include blockquote when memories are present but memoryDescription is absent', () => {
    const ctx = makeContext({
      memories: [
        { content: 'User prefers TypeScript', type: 'fact', source: 'file-memory' },
      ],
    });

    const result = formatContext(ctx);

    expect(result).not.toContain('> ');
    expect(result).toContain('User prefers TypeScript');
  });

  it('renders memory section with description even when memories array is empty', () => {
    const ctx = makeContext({
      memoryDescription: 'SQLite memory (FTS5). 0 entries.',
      memories: [],
    });

    const result = formatContext(ctx);

    expect(result).toContain('## Relevant Memory');
    expect(result).toContain('> SQLite memory (FTS5). 0 entries.');
  });

  it('renders no memory section when both memories and memoryDescription are absent', () => {
    const ctx = makeContext({
      memories: [],
    });

    const result = formatContext(ctx);

    expect(result).not.toContain('## Relevant Memory');
  });

  it('limits memory entries to 10 entries even when more are provided', () => {
    const memories = Array.from({ length: 15 }, (_, i) => ({
      content: `Memory entry ${i}`,
      type: 'log' as const,
      source: 'sqlite-memory',
    }));

    const ctx = makeContext({ memories });

    const result = formatContext(ctx);

    // entries 0–9 should be present, 10–14 should not
    expect(result).toContain('Memory entry 0');
    expect(result).toContain('Memory entry 9');
    expect(result).not.toContain('Memory entry 10');
    expect(result).not.toContain('Memory entry 14');
  });

  it('includes date in memory entry when present', () => {
    const ctx = makeContext({
      memories: [
        { content: 'Important decision made', type: 'decision', source: 'sqlite-memory', date: '2026-03-04' },
      ],
    });

    const result = formatContext(ctx);

    expect(result).toContain('(2026-03-04)');
  });

  it('description is rendered as a blockquote line (> prefix)', () => {
    const ctx = makeContext({
      memoryDescription: 'File-based memory. Directories: root:memory/.',
      memories: [],
    });

    const result = formatContext(ctx);

    const lines = result.split('\n');
    const descLine = lines.find(l => l.includes('File-based memory'));
    expect(descLine).toBeDefined();
    expect(descLine!.trim()).toMatch(/^>/);
  });
});
