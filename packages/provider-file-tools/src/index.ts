import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolProvider, Tool, Label, Node } from '@dot-ai/core';

export class FileToolProvider implements ToolProvider {
  private toolsDirs: Array<{ dir: string; node: string }>;
  private cache: Tool[] | null = null;

  constructor(options: Record<string, unknown> = {}) {
    const root = (options.root as string) ?? process.cwd();
    const nodes = (options.nodes as Node[]) ?? [{ name: 'root', path: join(root, '.ai'), root: true }];
    this.toolsDirs = nodes.map(n => ({ dir: join(n.path, 'tools'), node: n.name }));
  }

  async list(): Promise<Tool[]> {
    if (this.cache) return this.cache;

    const tools: Tool[] = [];

    for (const { dir: toolsDir, node } of this.toolsDirs) {
      let files: string[];
      try {
        files = await readdir(toolsDir);
      } catch {
        continue;
      }

      for (const file of files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))) {
        try {
          const content = await readFile(join(toolsDir, file), 'utf-8');
          const tool = parseToolYaml(content, file);
          if (tool) {
            tool.node = node;
            tools.push(tool);
          }
        } catch {
          // Skip invalid tools
        }
      }
    }

    this.cache = tools;
    return tools;
  }

  async match(labels: Label[]): Promise<Tool[]> {
    const all = await this.list();
    const labelNames = new Set(labels.map(l => l.name.toLowerCase()));
    return all.filter(tool =>
      tool.labels.some(tl => labelNames.has(tl.toLowerCase()))
    );
  }

  async load(name: string): Promise<Tool | null> {
    const all = await this.list();
    return all.find(t => t.name === name) ?? null;
  }
}

function parseToolYaml(content: string, filename: string): Tool | null {
  const name = extractValue(content, 'name') ?? filename.replace(/\.ya?ml$/, '');
  const description = extractValue(content, 'description') ?? '';
  const labelsRaw = content.match(/^labels:\s*\[(.*)\]/m);
  const labels = labelsRaw
    ? labelsRaw[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    : [];

  return {
    name,
    description,
    labels,
    config: {},
    source: 'file-tools',
  };
}

function extractValue(yaml: string, key: string): string | undefined {
  const match = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : undefined;
}
