import { readdir, readFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import type { PromptTemplate } from '@dot-ai/core';

export class FilePromptProvider {
  private readonly dirs: string[];
  private cache: PromptTemplate[] | null = null;

  constructor(options: Record<string, unknown>) {
    const root = (options.root as string) ?? process.cwd();
    const dirs = options.dirs as string | string[] | undefined;

    if (Array.isArray(dirs)) {
      this.dirs = dirs.map(d => join(root, d));
    } else if (typeof dirs === 'string') {
      this.dirs = [join(root, dirs)];
    } else {
      this.dirs = [join(root, '.ai', 'prompts')];
    }
  }

  async list(): Promise<PromptTemplate[]> {
    if (this.cache) return this.cache;

    const templates: PromptTemplate[] = [];

    for (const dir of this.dirs) {
      try {
        const entries = await readdir(dir);
        for (const entry of entries) {
          if (!entry.endsWith('.md') && !entry.endsWith('.txt')) continue;

          const filePath = join(dir, entry);
          const raw = await readFile(filePath, 'utf-8');
          const template = parsePromptFile(entry, raw);
          templates.push(template);
        }
      } catch {
        // Directory doesn't exist — skip
      }
    }

    this.cache = templates;
    return templates;
  }

  async load(name: string): Promise<string | null> {
    const templates = await this.list();
    const found = templates.find(t => t.name === name);
    return found?.content ?? null;
  }
}

function parsePromptFile(filename: string, raw: string): PromptTemplate {
  const name = basename(filename, extname(filename));

  if (raw.startsWith('---\n')) {
    const endIdx = raw.indexOf('\n---\n', 4);
    if (endIdx !== -1) {
      const frontmatter = raw.slice(4, endIdx);
      const content = raw.slice(endIdx + 5).trim();
      const meta = parseFrontmatter(frontmatter);

      return {
        name,
        content,
        description: meta.description,
        args: meta.args,
      };
    }
  }

  const argMatches = raw.match(/\$(\w+)/g);
  const args = argMatches
    ? [...new Set(argMatches.map(m => m.slice(1)))]
    : undefined;

  return { name, content: raw.trim(), args };
}

function parseFrontmatter(raw: string): { description?: string; args?: string[] } {
  const result: { description?: string; args?: string[] } = {};

  for (const line of raw.split('\n')) {
    const descMatch = line.match(/^description:\s*(.+)$/);
    if (descMatch) {
      result.description = descMatch[1].trim();
      continue;
    }

    const argsMatch = line.match(/^args:\s*\[(.+)\]$/);
    if (argsMatch) {
      result.args = argsMatch[1].split(',').map(a => a.trim());
    }
  }

  return result;
}
