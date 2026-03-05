import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteMemoryProvider } from '../index.js';

describe('SqliteMemoryProvider — deduplication on store()', () => {
  let provider: SqliteMemoryProvider;

  beforeEach(() => {
    provider = new SqliteMemoryProvider({ path: ':memory:' });
  });

  afterEach(() => {
    provider.close();
  });

  it('stores similar content twice → only 1 entry in DB', async () => {
    await provider.store({ content: 'Jo prefers French language for conversations', type: 'fact' });
    await provider.store({ content: 'Jo prefers French language for conversations', type: 'fact' });

    const results = await provider.search('Jo prefers French');
    expect(results).toHaveLength(1);
  });

  it('stores nearly identical content → deduplicates (Jaccard > 0.85)', async () => {
    await provider.store({ content: 'Jonathan prefers working in French language', type: 'fact' });
    await provider.store({ content: 'Jonathan prefers working in French language', type: 'fact' });

    const results = await provider.search('Jonathan French language');
    expect(results).toHaveLength(1);
  });

  it('stores different content → 2 entries', async () => {
    await provider.store({ content: 'Jo prefers French language for conversations', type: 'fact' });
    await provider.store({ content: 'The authentication system uses JWT tokens for authorization', type: 'fact' });

    const frenchResults = await provider.search('Jo prefers French');
    const authResults = await provider.search('authentication JWT tokens');
    expect(frenchResults).toHaveLength(1);
    expect(authResults).toHaveLength(1);
  });

  it('describes correct count after dedup (2 similar → 1 entry)', async () => {
    await provider.store({ content: 'Jo prefers French language for conversations', type: 'fact' });
    await provider.store({ content: 'Jo prefers French language for conversations', type: 'fact' });

    const description = provider.describe();
    expect(description).toContain('1 entries');
  });
});

describe('SqliteMemoryProvider — score bump on search()', () => {
  let provider: SqliteMemoryProvider;

  beforeEach(() => {
    provider = new SqliteMemoryProvider({ path: ':memory:' });
  });

  afterEach(() => {
    provider.close();
  });

  it('searching for memories increments recall_count and sets last_recalled', async () => {
    await provider.store({ content: 'Fixed the auth middleware N+1 bug properly', type: 'log' });

    // Search once
    const results1 = await provider.search('auth middleware');
    expect(results1).toHaveLength(1);

    // Verify recall_count was bumped in the DB
    const row = (provider as unknown as { db: import('better-sqlite3').Database })
      .db
      .prepare(`SELECT recall_count, last_recalled, score FROM memories WHERE content LIKE '%auth middleware%'`)
      .get() as { recall_count: number; last_recalled: string; score: number } | undefined;

    expect(row).toBeDefined();
    expect(row!.recall_count).toBe(1);
    expect(row!.last_recalled).toBe(new Date().toISOString().slice(0, 10));
    expect(row!.score).toBeCloseTo(1.1, 5);
  });

  it('searching multiple times accumulates score', async () => {
    await provider.store({ content: 'The routing logic determines model selection carefully', type: 'fact' });

    await provider.search('routing logic');
    await provider.search('routing logic');
    await provider.search('routing logic');

    const row = (provider as unknown as { db: import('better-sqlite3').Database })
      .db
      .prepare(`SELECT recall_count, score FROM memories WHERE content LIKE '%routing%'`)
      .get() as { recall_count: number; score: number } | undefined;

    expect(row).toBeDefined();
    expect(row!.recall_count).toBe(3);
    expect(row!.score).toBeCloseTo(1.3, 5);
  });

  it('score is capped at 5.0', async () => {
    await provider.store({ content: 'Critical architectural decision for the system', type: 'decision' });

    // Search 50 times to exceed cap
    for (let i = 0; i < 50; i++) {
      await provider.search('architectural decision');
    }

    const row = (provider as unknown as { db: import('better-sqlite3').Database })
      .db
      .prepare(`SELECT score FROM memories WHERE content LIKE '%architectural%'`)
      .get() as { score: number } | undefined;

    expect(row).toBeDefined();
    expect(row!.score).toBeLessThanOrEqual(5.0);
  });
});

describe('SqliteMemoryProvider — consolidate()', () => {
  let provider: SqliteMemoryProvider;

  beforeEach(() => {
    provider = new SqliteMemoryProvider({ path: ':memory:' });
  });

  afterEach(() => {
    provider.close();
  });

  it('deletes old logs with low score', async () => {
    // Insert an old log entry directly with low score
    const db = (provider as unknown as { db: import('better-sqlite3').Database }).db;
    const oldDate = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10); // 35 days ago
    db.prepare(
      `INSERT INTO memories (content, type, date, labels, score) VALUES (?, 'log', ?, '[]', 0.1)`
    ).run('Old low-score log entry from long ago', oldDate);

    const before = db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number };
    expect(before.c).toBe(1);

    const report = await provider.consolidate();
    expect(report.deleted).toBeGreaterThanOrEqual(1);

    const after = db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number };
    expect(after.c).toBe(0);
  });

  it('keeps recent entries even with low score', async () => {
    const db = (provider as unknown as { db: import('better-sqlite3').Database }).db;
    const recentDate = new Date().toISOString().slice(0, 10); // today
    db.prepare(
      `INSERT INTO memories (content, type, date, labels, score) VALUES (?, 'log', ?, '[]', 0.1)`
    ).run('Recent low-score log entry', recentDate);

    const report = await provider.consolidate();
    expect(report.deleted).toBe(0);

    const after = db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number };
    expect(after.c).toBe(1);
  });

  it('keeps lessons/decisions/facts even when old and low score', async () => {
    const db = (provider as unknown as { db: import('better-sqlite3').Database }).db;
    const veryOldDate = new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10); // 100 days ago

    db.prepare(
      `INSERT INTO memories (content, type, date, labels, score) VALUES (?, 'lesson', ?, '[]', 0.05)`
    ).run('Important lesson learned from a past mistake', veryOldDate);
    db.prepare(
      `INSERT INTO memories (content, type, date, labels, score) VALUES (?, 'decision', ?, '[]', 0.05)`
    ).run('Key architectural decision made last year', veryOldDate);
    db.prepare(
      `INSERT INTO memories (content, type, date, labels, score) VALUES (?, 'fact', ?, '[]', 0.05)`
    ).run('Critical fact about the system design', veryOldDate);

    const report = await provider.consolidate();
    expect(report.deleted).toBe(0);

    const after = db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number };
    expect(after.c).toBe(3);
  });

  it('consolidate returns archived=0 and deleted count', async () => {
    const report = await provider.consolidate();
    expect(report).toHaveProperty('archived', 0);
    expect(report).toHaveProperty('deleted');
    expect(typeof report.deleted).toBe('number');
  });

  it('deletes mixed old entries but preserves protected types', async () => {
    const db = (provider as unknown as { db: import('better-sqlite3').Database }).db;
    const oldDate = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10);
    const veryOldDate = new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10);

    // Should be deleted (old log, low score)
    db.prepare(`INSERT INTO memories (content, type, date, labels, score) VALUES (?, 'log', ?, '[]', 0.1)`)
      .run('Old log entry that should be removed', oldDate);

    // Should be kept (lesson, even very old and low score)
    db.prepare(`INSERT INTO memories (content, type, date, labels, score) VALUES (?, 'lesson', ?, '[]', 0.05)`)
      .run('Important lesson to keep forever', veryOldDate);

    // Should be kept (recent log, even low score)
    db.prepare(`INSERT INTO memories (content, type, date, labels, score) VALUES (?, 'log', ?, '[]', 0.1)`)
      .run('Recent log entry to keep', new Date().toISOString().slice(0, 10));

    const report = await provider.consolidate();
    expect(report.deleted).toBe(1);

    const after = db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number };
    expect(after.c).toBe(2);
  });
});
