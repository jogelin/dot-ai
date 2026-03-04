import { readdir, readFile, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoryProvider, MemoryEntry, Node } from '@dot-ai/core';

export class FileMemoryProvider implements MemoryProvider {
  private nodes: Node[];

  constructor(options: Record<string, unknown> = {}) {
    const root = (options.root as string) ?? process.cwd();
    this.nodes = (options.nodes as Node[]) ?? [{ name: 'root', path: join(root, '.ai'), root: true }];
  }

  async search(query: string, labels?: string[]): Promise<MemoryEntry[]> {
    const results: MemoryEntry[] = [];
    const lower = query.toLowerCase();
    const labelSet = new Set(labels?.map(l => l.toLowerCase()) ?? []);

    for (const node of this.nodes) {
      const memoryDir = join(node.path, 'memory');
      let files: string[];
      try {
        files = await readdir(memoryDir);
      } catch {
        continue; // No memory directory in this node
      }

      for (const file of files.filter(f => f.endsWith('.md')).sort().reverse()) {
        try {
          const content = await readFile(join(memoryDir, file), 'utf-8');
          const lines = content.split('\n');

          for (const line of lines) {
            if (line.trim() === '') continue;
            const lineLower = line.toLowerCase();

            const queryMatch = lower.split(/\s+/).some(word => word.length > 2 && lineLower.includes(word));
            const labelMatch = labelSet.size > 0 && [...labelSet].some(l => lineLower.includes(l));

            if (queryMatch || labelMatch) {
              results.push({
                content: line.trim(),
                type: 'log',
                source: 'file-memory',
                date: file.replace('.md', ''),
                labels: labels?.filter(l => lineLower.includes(l.toLowerCase())),
                node: node.name,
              });
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    }

    return results;
  }

  describe(): string {
    const dirs = this.nodes.map(n => `${n.name}:memory/`).join(', ');
    return `File-based memory (markdown files). Directories: ${dirs}. Write memories to daily files (YYYY-MM-DD.md) or long-term MEMORY.md.`;
  }

  async store(entry: Omit<MemoryEntry, 'source'>): Promise<void> {
    // Route write to the specified node, or root by default
    const targetNode = (entry.node
      ? this.nodes.find(n => n.name === entry.node)
      : undefined) ?? this.nodes.find(n => n.root)!;
    const memDir = join(targetNode.path, 'memory');
    await mkdir(memDir, { recursive: true });
    const date = entry.date ?? new Date().toISOString().slice(0, 10);
    const filePath = join(memDir, `${date}.md`);
    const line = `- ${entry.content}\n`;
    await appendFile(filePath, line, 'utf-8');
  }
}
