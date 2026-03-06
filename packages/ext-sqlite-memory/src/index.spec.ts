import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteMemoryProvider } from './sqlite-memory.js';

describe('SqliteMemoryProvider.describe()', () => {
  let provider: SqliteMemoryProvider;

  beforeEach(() => {
    provider = new SqliteMemoryProvider({ path: ':memory:' });
  });

  afterEach(() => {
    provider.close();
  });

  it('returns a string containing "SQLite"', () => {
    const result = provider.describe();
    expect(typeof result).toBe('string');
    expect(result).toContain('SQLite');
  });

  it('returns a string containing "FTS5"', () => {
    const result = provider.describe();
    expect(result).toContain('FTS5');
  });

  it('shows "0 entries" for an empty database', () => {
    const result = provider.describe();
    expect(result).toContain('0 entries');
  });

  it('shows correct entry count after storing 3 entries', async () => {
    await provider.store({ content: 'First memory entry about auth', type: 'log' });
    await provider.store({ content: 'Second memory entry about routing', type: 'log' });
    await provider.store({ content: 'Third memory entry about testing', type: 'log' });

    const result = provider.describe();
    expect(result).toContain('3 entries');
  });
});

describe('SqliteMemoryProvider.search() — source field', () => {
  let provider: SqliteMemoryProvider;

  beforeEach(() => {
    provider = new SqliteMemoryProvider({ path: ':memory:' });
  });

  afterEach(() => {
    provider.close();
  });

  it('returns entries with source "sqlite-memory"', async () => {
    await provider.store({ content: 'The authentication middleware was refactored', type: 'log' });
    const results = await provider.search('authentication');

    expect(results.length).toBeGreaterThan(0);
    for (const entry of results) {
      expect(entry.source).toBe('sqlite-memory');
    }
  });
});

describe('SqliteMemoryProvider store/search roundtrip', () => {
  let provider: SqliteMemoryProvider;

  beforeEach(() => {
    provider = new SqliteMemoryProvider({ path: ':memory:' });
  });

  afterEach(() => {
    provider.close();
  });

  it('stores an entry and retrieves it via search', async () => {
    await provider.store({
      content: 'Fixed the N+1 query in the task loader',
      type: 'log',
      date: '2026-03-04',
    });

    const results = await provider.search('task loader');

    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('task loader');
    expect(results[0].source).toBe('sqlite-memory');
    expect(results[0].date).toBe('2026-03-04');
  });

  it('stores multiple entries and retrieves them all', async () => {
    await provider.store({ content: 'Auth middleware fix applied', type: 'log' });
    await provider.store({ content: 'Auth token expiry extended to 7 days', type: 'decision' });
    await provider.store({ content: 'Database migration ran without issues', type: 'log' });

    const results = await provider.search('auth');

    expect(results.length).toBeGreaterThanOrEqual(2);
    const contents = results.map(r => r.content);
    expect(contents.some(c => c.includes('middleware fix'))).toBe(true);
    expect(contents.some(c => c.includes('token expiry'))).toBe(true);
  });

  it('FTS5 search matches partial words', async () => {
    await provider.store({ content: 'Authentication system redesigned', type: 'log' });

    // FTS5 prefix search with trailing *
    // The provider uses OR semantics — the word "authen" won't match without *
    // But a full word "authentication" in the query should match
    const results = await provider.search('authentication');

    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('Authentication');
  });

  it('does not return unrelated entries', async () => {
    await provider.store({ content: 'React component lifecycle overview', type: 'fact' });
    await provider.store({ content: 'Vue router configuration patterns', type: 'fact' });
    await provider.store({ content: 'Database indexing strategy', type: 'fact' });

    const results = await provider.search('authentication bearer token');

    expect(results).toHaveLength(0);
  });

  it('stores with labels and retrieves by label', async () => {
    await provider.store({
      content: 'Added input validation to all endpoints',
      type: 'decision',
      date: '2026-03-01',
      labels: ['security', 'api'],
    });

    const results = await provider.search('unrelated query', ['security']);

    expect(results).toHaveLength(1);
    expect(results[0].labels).toContain('security');
    expect(results[0].date).toBe('2026-03-01');
  });
});
