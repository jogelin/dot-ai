import { readdir, readFile, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoryProvider } from '../contracts.js';
import type { MemoryEntry } from '../types.js';

export class FileMemoryProvider implements MemoryProvider {
  private memoryDir: string;

  constructor(options: Record<string, unknown> = {}) {
    const root = (options.root as string) ?? process.cwd();
    this.memoryDir = join(root, '.ai', 'memory');
  }

  async search(query: string, labels?: string[]): Promise<MemoryEntry[]> {
    const results: MemoryEntry[] = [];
    const lower = query.toLowerCase();
    const labelSet = new Set(labels?.map(l => l.toLowerCase()) ?? []);

    let files: string[];
    try {
      files = await readdir(this.memoryDir);
    } catch {
      return []; // No memory directory yet
    }

    // Read all .md files, search for matches
    for (const file of files.filter(f => f.endsWith('.md')).sort().reverse()) {
      try {
        const content = await readFile(join(this.memoryDir, file), 'utf-8');
        const lines = content.split('\n');

        for (const line of lines) {
          if (line.trim() === '') continue;
          const lineLower = line.toLowerCase();

          // Match if query appears in line OR any label matches
          const queryMatch = lower.split(/\s+/).some(word => word.length > 2 && lineLower.includes(word));
          const labelMatch = labelSet.size > 0 && [...labelSet].some(l => lineLower.includes(l));

          if (queryMatch || labelMatch) {
            results.push({
              content: line.trim(),
              type: 'log',
              source: 'file-memory',
              date: file.replace('.md', ''),
              labels: labels?.filter(l => lineLower.includes(l.toLowerCase())),
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return results;
  }

  async store(entry: Omit<MemoryEntry, 'source'>): Promise<void> {
    await mkdir(this.memoryDir, { recursive: true });
    const date = entry.date ?? new Date().toISOString().slice(0, 10);
    const filePath = join(this.memoryDir, `${date}.md`);
    const line = `- ${entry.content}\n`;
    await appendFile(filePath, line, 'utf-8');
  }
}
