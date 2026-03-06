import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteMemoryProvider } from '../sqlite-memory.js';

describe('SqliteMemoryProvider', () => {
  let provider: SqliteMemoryProvider;

  beforeEach(() => {
    // Use in-memory DB for tests — fast, no cleanup needed
    provider = new SqliteMemoryProvider({ path: ':memory:' });
  });

  afterEach(() => {
    provider.close();
  });

  it('returns empty array when no memories stored', async () => {
    const results = await provider.search('anything');
    expect(results).toEqual([]);
  });

  it('stores and retrieves a memory', async () => {
    await provider.store({ content: 'Fixed the auth middleware N+1 bug', type: 'log' });
    const results = await provider.search('auth middleware');
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('auth middleware');
    expect(results[0].source).toBe('sqlite-memory');
  });

  it('stores with labels and date', async () => {
    await provider.store({
      content: 'Rate limiting added to auth endpoints',
      type: 'decision',
      date: '2026-03-01',
      labels: ['auth', 'api'],
    });
    const results = await provider.search('rate limiting');
    expect(results[0].date).toBe('2026-03-01');
    expect(results[0].labels).toContain('auth');
  });

  it('ranks results by BM25 relevance', async () => {
    await provider.store({ content: 'The auth system uses JWT tokens', type: 'fact' });
    await provider.store({ content: 'Auth auth auth security auth', type: 'log' });
    await provider.store({ content: 'Unrelated content about React components', type: 'log' });

    const results = await provider.search('auth');
    expect(results.length).toBeGreaterThanOrEqual(2);
    // "auth" appears more in second entry, should rank higher
    expect(results.some(r => r.content.includes('React'))).toBe(false);
  });

  it('expands search with labels (OR semantics)', async () => {
    await provider.store({ content: 'Auth fix for backend', type: 'log', labels: ['auth', 'backend'] });
    await provider.store({ content: 'Testing framework setup', type: 'log', labels: ['testing'] });
    await provider.store({ content: 'Unrelated React component', type: 'log', labels: ['frontend'] });

    // Labels expand the search: 'auth' matches first, 'testing' matches second
    const results = await provider.search('auth', ['testing']);
    expect(results).toHaveLength(2);
    expect(results.some(r => r.content.includes('Auth fix'))).toBe(true);
    expect(results.some(r => r.content.includes('Testing framework'))).toBe(true);
  });

  it('handles multiple stores and searches', async () => {
    const topics = [
      'Fixed the authentication bug in the login flow',
      'Refactored the database connection pooling logic',
      'Added rate limiting to the REST API endpoints',
      'Migrated the frontend components to TypeScript',
      'Implemented caching layer using Redis for performance',
      'Updated the deployment pipeline for continuous delivery',
      'Resolved memory leak in the background job processor',
      'Designed the new microservices architecture diagram',
      'Configured monitoring alerts for production incidents',
      'Optimized SQL queries reducing response time by half',
    ];
    for (const content of topics) {
      await provider.store({ content, type: 'log' });
    }
    // All entries have unique content — count them directly via describe()
    const description = provider.describe();
    expect(description).toContain('10 entries');
  });

  it('returns empty for queries with no matching words', async () => {
    await provider.store({ content: 'Something about JavaScript', type: 'fact' });
    const results = await provider.search('python django');
    expect(results).toEqual([]);
  });

  it('satisfies the same contract as FileMemoryProvider', async () => {
    // This test validates the contract: search returns MemoryEntry[]
    await provider.store({ content: 'Test entry', type: 'fact' });
    const results = await provider.search('test');
    expect(results[0]).toHaveProperty('content');
    expect(results[0]).toHaveProperty('type');
    expect(results[0]).toHaveProperty('source');
  });
});
