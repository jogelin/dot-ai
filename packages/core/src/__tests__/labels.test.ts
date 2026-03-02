import { describe, it, expect } from 'vitest';
import { extractLabels, buildVocabulary } from '../labels.js';

describe('extractLabels', () => {
  it('returns matched labels from vocabulary', () => {
    const labels = extractLabels('I need to fix the memory issue', ['memory', 'routing', 'skills']);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toEqual({ name: 'memory', source: 'extract' });
  });

  it('returns multiple matches when several vocabulary words are present', () => {
    const labels = extractLabels('routing and memory both matter', ['memory', 'routing', 'skills']);
    expect(labels).toHaveLength(2);
    const names = labels.map((l) => l.name);
    expect(names).toContain('memory');
    expect(names).toContain('routing');
  });

  it('returns empty array when no vocabulary words match', () => {
    const labels = extractLabels('hello world', ['memory', 'routing', 'skills']);
    expect(labels).toHaveLength(0);
  });

  it('is case insensitive', () => {
    const labels = extractLabels('MEMORY is important', ['memory']);
    expect(labels).toHaveLength(1);
    expect(labels[0].name).toBe('memory');
  });

  it('is case insensitive for vocabulary words too', () => {
    const labels = extractLabels('memory is important', ['Memory']);
    expect(labels).toHaveLength(1);
    expect(labels[0].name).toBe('Memory');
  });

  it('sets source to "extract" for all labels', () => {
    const labels = extractLabels('use routing for memory', ['routing', 'memory']);
    for (const label of labels) {
      expect(label.source).toBe('extract');
    }
  });

  it('returns empty array when vocabulary is empty', () => {
    const labels = extractLabels('any prompt at all', []);
    expect(labels).toHaveLength(0);
  });

  it('matches partial words within a prompt', () => {
    const labels = extractLabels('my skillset is broad', ['skill']);
    expect(labels).toHaveLength(1);
    expect(labels[0].name).toBe('skill');
  });
});

describe('buildVocabulary', () => {
  it('merges skill labels and tool labels into a flat array', () => {
    const vocab = buildVocabulary([['memory', 'routing']], [['ui', 'ux']]);
    expect(vocab).toContain('memory');
    expect(vocab).toContain('routing');
    expect(vocab).toContain('ui');
    expect(vocab).toContain('ux');
  });

  it('deduplicates labels appearing in multiple skills', () => {
    const vocab = buildVocabulary([['memory', 'routing'], ['memory', 'skills']], []);
    const memoryCount = vocab.filter((v) => v === 'memory').length;
    expect(memoryCount).toBe(1);
  });

  it('deduplicates labels appearing across skills and tools', () => {
    const vocab = buildVocabulary([['shared']], [['shared']]);
    const count = vocab.filter((v) => v === 'shared').length;
    expect(count).toBe(1);
  });

  it('returns empty array when both inputs are empty', () => {
    const vocab = buildVocabulary([], []);
    expect(vocab).toHaveLength(0);
  });

  it('handles empty skill label arrays', () => {
    const vocab = buildVocabulary([[], []], [['tool-label']]);
    expect(vocab).toEqual(['tool-label']);
  });

  it('returns unique values only', () => {
    const vocab = buildVocabulary([['a', 'b', 'a']], [['b', 'c']]);
    expect(vocab.length).toBe(3);
    expect(new Set(vocab).size).toBe(3);
  });
});
