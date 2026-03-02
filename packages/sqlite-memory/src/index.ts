import Database from 'better-sqlite3';
import type { MemoryProvider } from '@dot-ai/core';
import type { MemoryEntry } from '@dot-ai/core';

export class SqliteMemoryProvider implements MemoryProvider {
  private db: Database.Database;

  constructor(options: Record<string, unknown> = {}) {
    const dbPath = (options.path as string) ?? ':memory:';
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT    NOT NULL,
        type    TEXT    NOT NULL DEFAULT 'log',
        date    TEXT,
        labels  TEXT    DEFAULT '[]',
        created INTEGER DEFAULT (unixepoch())
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        labels,
        content='memories',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, labels)
        VALUES (new.id, new.content, new.labels);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, labels)
        VALUES ('delete', old.id, old.content, old.labels);
      END;
    `);
  }

  async store(entry: Omit<MemoryEntry, 'source'>): Promise<void> {
    const stmt = this.db.prepare(
      'INSERT INTO memories (content, type, date, labels) VALUES (?, ?, ?, ?)'
    );
    stmt.run(
      entry.content,
      entry.type ?? 'log',
      entry.date ?? new Date().toISOString().slice(0, 10),
      JSON.stringify(entry.labels ?? []),
    );
  }

  async search(query: string, labels?: string[]): Promise<MemoryEntry[]> {
    // Clean query for FTS5: remove special chars, keep words
    const cleanQuery = query
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1)
      .join(' OR ');

    if (!cleanQuery) return [];

    const rows = this.db.prepare(`
      SELECT m.content, m.type, m.date, m.labels,
             bm25(memories_fts) AS rank
      FROM memories_fts
      JOIN memories m ON m.id = memories_fts.rowid
      WHERE memories_fts MATCH ?
      ORDER BY rank
      LIMIT 20
    `).all(cleanQuery) as Array<{
      content: string;
      type: string;
      date: string | null;
      labels: string;
      rank: number;
    }>;

    let results = rows.map(row => ({
      content: row.content,
      type: row.type,
      source: 'sqlite-memory' as const,
      date: row.date ?? undefined,
      labels: JSON.parse(row.labels) as string[],
    }));

    // Filter by labels if provided
    if (labels?.length) {
      const labelSet = new Set(labels.map(l => l.toLowerCase()));
      results = results.filter(r =>
        r.labels?.some(l => labelSet.has(l.toLowerCase()))
      );
    }

    return results;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}
