/**
 * @dot-ai/ext-file-tools — File-based tool metadata extension.
 * Reads tool definitions from .ai/tools/*.yaml
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExtensionAPI } from '@dot-ai/core';
import { discoverNodes, parseScanDirs } from '@dot-ai/core';

interface ToolMeta {
  name: string;
  description: string;
  labels: string[];
  node?: string;
}

export default function extFileTools(api: ExtensionAPI): void {
  const nodes = discoverNodes(api.workspaceRoot, parseScanDirs('projects'));
  const toolsDirs = nodes.map(n => ({ dir: join(n.path, 'tools'), node: n.name }));
  let cache: ToolMeta[] | null = null;

  async function listTools(): Promise<ToolMeta[]> {
    if (cache) return cache;
    const tools: ToolMeta[] = [];
    for (const { dir, node } of toolsDirs) {
      let files: string[];
      try { files = await readdir(dir); } catch { continue; }
      for (const file of files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))) {
        try {
          const content = await readFile(join(dir, file), 'utf-8');
          const tool = parseToolYaml(content, file);
          if (tool) { tool.node = node; tools.push(tool); }
        } catch { /* skip */ }
      }
    }
    cache = tools;
    return tools;
  }

  api.on('resources_discover', async () => {
    const tools = await listTools();
    const labels = new Set<string>();
    for (const t of tools) for (const l of t.labels) labels.add(l);
    return { labels: Array.from(labels) };
  });

  api.on('context_enrich', async (event) => {
    const tools = await listTools();
    const labelNames = new Set(event.labels.map((l: { name: string }) => l.name.toLowerCase()));
    const matched = tools.filter(t => t.labels.some(tl => labelNames.has(tl.toLowerCase())));
    if (matched.length === 0) return;
    const lines = matched.map(t => `- **${t.name}**: ${t.description}`);
    return {
      sections: [{
        id: 'tools:matched',
        title: 'Available Tools',
        content: lines.join('\n'),
        priority: 30,
        source: 'ext-file-tools',
        trimStrategy: 'drop' as const,
      }],
    };
  });
}

function parseToolYaml(content: string, filename: string): ToolMeta | null {
  const name = extractValue(content, 'name') ?? filename.replace(/\.ya?ml$/, '');
  const description = extractValue(content, 'description') ?? '';
  const labelsRaw = content.match(/^labels:\s*\[(.*)\]/m);
  const labels = labelsRaw
    ? labelsRaw[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    : [];
  return { name, description, labels };
}

function extractValue(yaml: string, key: string): string | undefined {
  const m = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
}
