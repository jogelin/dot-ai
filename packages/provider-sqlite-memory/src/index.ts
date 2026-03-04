import Database from 'better-sqlite3';
import { join } from 'node:path';
import type { MemoryProvider } from '@dot-ai/core';
import type { MemoryEntry } from '@dot-ai/core';

export class SqliteMemoryProvider implements MemoryProvider {
  private db: Database.Database;

  constructor(options: Record<string, unknown> = {}) {
    const root = (options.root as string) ?? process.cwd();
    const rawPath = (options.path as string) ?? ':memory:';
    const dbPath = rawPath === ':memory:' ? rawPath : (rawPath.startsWith('/') ? rawPath : join(root, rawPath));
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
        node    TEXT,
        source  TEXT    DEFAULT 'sqlite-memory',
        created INTEGER DEFAULT (unixepoch())
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
  }

  async store(entry: Omit<MemoryEntry, 'source'>): Promise<void> {
    const stmt = this.db.prepare(
      'INSERT INTO memories (content, type, date, labels, node) VALUES (?, ?, ?, ?, ?)'
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
    // Build FTS5 query: combine prompt words + labels (OR semantics, like file-memory)
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

    const rows = this.db.prepare(`
      SELECT m.content, m.type, m.date, m.labels, m.node,
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
      node: string | null;
      rank: number;
    }>;

    return rows.map(row => ({
      content: row.content,
      type: row.type,
      source: 'sqlite-memory' as const,
      date: row.date ?? undefined,
      labels: JSON.parse(row.labels) as string[],
      node: row.node ?? undefined,
    }));
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}
