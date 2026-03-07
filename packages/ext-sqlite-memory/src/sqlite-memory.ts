import Database from 'better-sqlite3';
import { join } from 'node:path';
import type { MemoryEntry } from '@dot-ai/core';

/**
 * Compute Jaccard similarity between two strings (word-level).
 * similarity = |intersection| / |union|
 */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(
    a.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 1)
  );
  const wordsB = new Set(
    b.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 1)
  );
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return intersection / union;
}

export class SqliteMemoryProvider {
  private db: Database.Database;

  constructor(options: Record<string, unknown> = {}) {
    const root = (options.root as string) ?? process.cwd();
    const rawPath = (options.path as string) ?? (options.root ? '.ai/memory.db' : ':memory:');
    const dbPath = rawPath === ':memory:' ? rawPath : (rawPath.startsWith('/') ? rawPath : join(root, rawPath));
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        content      TEXT    NOT NULL,
        type         TEXT    NOT NULL DEFAULT 'log',
        date         TEXT,
        labels       TEXT    DEFAULT '[]',
        node         TEXT,
        source       TEXT    DEFAULT 'sqlite-memory',
        created      INTEGER DEFAULT (unixepoch())
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        labels,
        node,
        content='memories',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, labels, node)
        VALUES (new.id, new.content, new.labels, new.node);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, labels, node)
        VALUES ('delete', old.id, old.content, old.labels, old.node);
      END;
    `);

    // Graceful migration: add lifecycle columns if they don't exist
    const existingCols = (this.db.prepare(`PRAGMA table_info(memories)`).all() as Array<{ name: string }>)
      .map(c => c.name);

    if (!existingCols.includes('score')) {
      this.db.exec(`ALTER TABLE memories ADD COLUMN score REAL DEFAULT 1.0`);
    }
    if (!existingCols.includes('last_recalled')) {
      this.db.exec(`ALTER TABLE memories ADD COLUMN last_recalled TEXT`);
    }
    if (!existingCols.includes('recall_count')) {
      this.db.exec(`ALTER TABLE memories ADD COLUMN recall_count INTEGER DEFAULT 0`);
    }
  }

  async store(entry: Omit<MemoryEntry, 'source'>): Promise<void> {
    const content = entry.content;

    // Extract key terms for FTS dedup check
    const queryWords = content
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1);

    if (queryWords.length > 0) {
      const ftsQuery = queryWords.join(' OR ');
      let candidates: Array<{ id: number; content: string }> = [];
      try {
        candidates = this.db.prepare(`
          SELECT m.id, m.content
          FROM memories_fts
          JOIN memories m ON m.id = memories_fts.rowid
          WHERE memories_fts MATCH ?
          LIMIT 10
        `).all(ftsQuery) as typeof candidates;
      } catch {
        // FTS error — fall through to insert
      }

      for (const candidate of candidates) {
        const similarity = jaccardSimilarity(content, candidate.content);
        if (similarity > 0.85) {
          // Duplicate found — update existing entry instead of inserting
          this.db.prepare(
            `UPDATE memories SET content = ?, date = ?, score = MIN(score + 0.1, 5.0) WHERE id = ?`
          ).run(
            content,
            entry.date ?? new Date().toISOString().slice(0, 10),
            candidate.id,
          );
          // Update FTS index for the modified row
          this.db.prepare(
            `INSERT INTO memories_fts(memories_fts, rowid, content, labels, node) VALUES ('delete', ?, ?, ?, ?)`
          ).run(candidate.id, candidate.content, '[]', null);
          const updated = this.db.prepare(`SELECT content, labels, node FROM memories WHERE id = ?`).get(candidate.id) as { content: string; labels: string; node: string | null };
          this.db.prepare(
            `INSERT INTO memories_fts(rowid, content, labels, node) VALUES (?, ?, ?, ?)`
          ).run(candidate.id, updated.content, updated.labels, updated.node);
          return;
        }
      }
    }

    // No duplicate found — insert new entry
    const stmt = this.db.prepare(
      'INSERT INTO memories (content, type, date, labels, node, score, recall_count) VALUES (?, ?, ?, ?, ?, 1.0, 0)'
    );
    stmt.run(
      entry.content,
      entry.type ?? 'log',
      entry.date ?? new Date().toISOString().slice(0, 10),
      JSON.stringify(entry.labels ?? []),
      entry.node ?? null,
    );
  }

  async search(query: string, labels?: string[]): Promise<MemoryEntry[]> {
    const queryWords = query
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1);

    const labelWords = (labels ?? [])
      .map(l => l.replace(/[^\w\s]/g, '').trim())
      .filter(w => w.length > 1);

    const allTerms = [...new Set([...queryWords, ...labelWords])];
    const cleanQuery = allTerms.join(' OR ');

    if (!cleanQuery) return [];

    let rows: Array<{
      id: number;
      content: string;
      type: string;
      date: string | null;
      labels: string;
      node: string | null;
      score: number;
      rank: number;
    }>;

    try {
      rows = this.db.prepare(`
        SELECT m.id, m.content, m.type, m.date, m.labels, m.node, m.score,
               bm25(memories_fts) AS rank
        FROM memories_fts
        JOIN memories m ON m.id = memories_fts.rowid
        WHERE memories_fts MATCH ?
        ORDER BY rank
        LIMIT 20
      `).all(cleanQuery) as typeof rows;
    } catch {
      return [];
    }

    // Score bump: increment score, update last_recalled, increment recall_count
    if (rows.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const updateStmt = this.db.prepare(`
        UPDATE memories
        SET score = MIN(score + 0.1, 5.0),
            last_recalled = ?,
            recall_count = recall_count + 1
        WHERE id = ?
      `);
      for (const row of rows) {
        updateStmt.run(today, row.id);
      }
    }

    return rows.map(row => ({
      content: row.content,
      type: row.type,
      source: 'sqlite-memory' as const,
      date: row.date ?? undefined,
      labels: JSON.parse(row.labels) as string[],
      node: row.node ?? undefined,
    }));
  }

  async consolidate(): Promise<{ archived: number; deleted: number }> {
    const now = Date.now();
    const day = 86400000;

    const deletedLogs = this.db.prepare(
      `DELETE FROM memories WHERE type = 'log' AND date < ? AND score < 0.3`
    ).run(new Date(now - 30 * day).toISOString().slice(0, 10));

    const deletedNotes = this.db.prepare(
      `DELETE FROM memories WHERE type = 'note' AND date < ? AND score < 0.3`
    ).run(new Date(now - 60 * day).toISOString().slice(0, 10));

    const deletedOld = this.db.prepare(
      `DELETE FROM memories WHERE type NOT IN ('lesson', 'decision', 'fact') AND date < ? AND score < 0.1`
    ).run(new Date(now - 90 * day).toISOString().slice(0, 10));

    return {
      archived: 0,
      deleted: (deletedLogs.changes as number) + (deletedNotes.changes as number) + (deletedOld.changes as number),
    };
  }

  describe(): string {
    const count = (this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number }).count;
    return `Memory: SQLite with FTS5 full-text search (${count} entries). Use memory_recall to search, memory_store to save. This is the ONLY memory system — do not read or write memory/*.md files.`;
  }

  close(): void {
    this.db.close();
  }
}
