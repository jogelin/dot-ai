/**
 * @dot-ai/ext-file-identity — File-based identity extension.
 *
 * Loads AGENTS.md, SOUL.md, USER.md, IDENTITY.md from .ai/
 *
 * Progressive disclosure: if a file has a YAML frontmatter with `summary:`,
 * only the summary is injected by default. The full content is available
 * via the agent's file-reading tools (e.g. `read .ai/AGENTS.md`).
 *
 * Example frontmatter:
 * ```
 * ---
 * summary: |
 *   Agent rules: safety-first, git discipline, no duplication.
 *   Full rules: read `.ai/AGENTS.md`
 * ---
 * # AGENTS.md - Full Rules
 * ...
 * ```
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExtensionAPI } from '@dot-ai/core';
import { discoverNodes, parseScanDirs } from '@dot-ai/core';

const ROOT_FILES = [
  { type: 'agents', file: 'AGENTS.md', priority: 100 },
  { type: 'soul', file: 'SOUL.md', priority: 90 },
  { type: 'user', file: 'USER.md', priority: 80 },
  { type: 'identity', file: 'IDENTITY.md', priority: 70 },
];

const PROJECT_FILES = [
  { type: 'agent', file: 'AGENT.md', priority: 50 },
];

/**
 * Parse YAML frontmatter from markdown content.
 * Returns { summary, body } where summary is from frontmatter
 * and body is the content after the frontmatter.
 */
function parseFrontmatter(content: string): { summary?: string; body: string } {
  if (!content.startsWith('---')) return { body: content };
  const endIdx = content.indexOf('\n---', 3);
  if (endIdx === -1) return { body: content };

  const frontmatter = content.slice(4, endIdx);
  const body = content.slice(endIdx + 4).replace(/^\s+/, '');

  // Extract summary field from YAML (simple parser, no deps)
  const summaryMatch = frontmatter.match(/^summary:\s*\|?\s*\n([\s\S]*?)(?=\n\w|\n---|\s*$)/m);
  if (summaryMatch) {
    const summary = summaryMatch[1]
      .split('\n')
      .map(line => line.replace(/^\s{2,}/, ''))
      .join('\n')
      .trim();
    return { summary, body };
  }

  // Single-line summary
  const singleMatch = frontmatter.match(/^summary:\s*["']?(.+?)["']?\s*$/m);
  if (singleMatch) {
    return { summary: singleMatch[1].trim(), body };
  }

  return { body: content };
}

export default async function extFileIdentity(api: ExtensionAPI): Promise<void> {
  const nodes = discoverNodes(api.workspaceRoot, parseScanDirs('projects'));
  const rootNodes = nodes.filter(n => n.root);
  const projectNodes = nodes.filter(n => !n.root);

  api.contributeLabels(projectNodes.map(n => n.name));

  // Cache parsed files at boot
  const fileCache = new Map<string, { summary?: string; body: string; full: string }>();

  for (const node of rootNodes) {
    for (const { type, file, priority } of ROOT_FILES) {
      try {
        const filePath = join(node.path, file);
        const full = await readFile(filePath, 'utf-8');
        const parsed = parseFrontmatter(full);
        const key = `${node.name}:${type}`;
        fileCache.set(key, { ...parsed, full });

        // Register with full content for runtime.identities accessor
        api.registerIdentity({ type, content: full, source: 'ext-file-identity', priority, node: node.name });
      } catch { /* skip */ }
    }
  }

  api.on('context_enrich', async (event) => {
    const sections = [];

    for (const node of rootNodes) {
      for (const { type, file, priority } of ROOT_FILES) {
        const key = `${node.name}:${type}`;
        const cached = fileCache.get(key);
        if (!cached) continue;

        // Progressive disclosure: use summary if available, full content otherwise
        const content = cached.summary
          ? `${cached.summary}\n\n> Full content: read \`.ai/${file}\``
          : cached.full;

        sections.push({
          id: `identity:${type}:${node.name}`,
          title: file.replace('.md', ''),
          content,
          priority,
          source: 'ext-file-identity',
          trimStrategy: 'never' as const,
        });
      }
    }

    const labelNames = new Set(event.labels.map((l: { name: string }) => l.name));
    for (const node of projectNodes) {
      if (!labelNames.has(node.name)) continue;
      for (const { type, file, priority } of PROJECT_FILES) {
        try {
          const content = await readFile(join(node.path, file), 'utf-8');
          sections.push({
            id: `identity:${type}:${node.name}`,
            title: `${node.name} — ${file.replace('.md', '')}`,
            content,
            priority,
            source: 'ext-file-identity',
            trimStrategy: 'drop' as const,
          });
        } catch { /* skip */ }
      }
    }

    if (sections.length === 0) return;
    return { sections };
  });
}
