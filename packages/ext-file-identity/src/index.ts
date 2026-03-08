/**
 * @dot-ai/ext-file-identity — File-based identity extension.
 *
 * Loads AGENTS.md, SOUL.md, USER.md, IDENTITY.md from .ai/
 *
 * Progressive disclosure strategy:
 * 1. If file has frontmatter `summary:` → use that (user-defined compact version)
 * 2. If file is small (≤ 500 chars) → inject full content (already compact)
 * 3. Otherwise → auto-extract: headings + first bullet/paragraph per section
 *
 * Full content always available via `read .ai/{file}`
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

/** Max chars for auto-compact (files under this are injected in full) */
const COMPACT_THRESHOLD = 500;

/** Max chars for auto-extracted summary */
const MAX_SUMMARY_CHARS = 600;

/**
 * Parse YAML frontmatter from markdown content.
 */
function parseFrontmatter(content: string): { summary?: string; body: string } {
  if (!content.startsWith('---')) return { body: content };
  const endIdx = content.indexOf('\n---', 3);
  if (endIdx === -1) return { body: content };

  const frontmatter = content.slice(4, endIdx);
  const body = content.slice(endIdx + 4).replace(/^\s+/, '');

  // Multi-line summary
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

/**
 * Auto-extract a compact summary from markdown content.
 * Strategy:
 * - H1 title: always include
 * - Content between H1 and first H2: include (often has key info like name, etc.)
 * - Each H2 section: heading + first bullet/paragraph line only
 * Deterministic, no LLM.
 */
function autoExtract(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let seenFirstH2 = false;
  let currentSection = '';
  let sectionHasContent = false;

  for (const line of lines) {
    // H1 — always include
    if (line.startsWith('# ') && !line.startsWith('## ')) {
      result.push(line);
      continue;
    }

    // Content between H1 and first H2 — include all non-empty lines (key info)
    if (!seenFirstH2 && !line.startsWith('#') && line.trim()) {
      result.push(line);
      continue;
    }

    // H2 — include heading, prepare for first content line
    if (line.startsWith('## ')) {
      seenFirstH2 = true;
      currentSection = line;
      sectionHasContent = false;
      result.push(line);
      continue;
    }

    // Skip H3+ headings in summary
    if (line.startsWith('###')) continue;

    // First meaningful content line after a H2
    if (currentSection && !sectionHasContent && line.trim()) {
      if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('> ') || !line.startsWith('#')) {
        result.push(line);
        sectionHasContent = true;
      }
    }
  }

  let summary = result.join('\n').trim();
  if (summary.length > MAX_SUMMARY_CHARS) {
    summary = summary.slice(0, MAX_SUMMARY_CHARS) + '…';
  }
  return summary;
}

/**
 * Build the injected content for an identity file.
 * Progressive: summary (frontmatter or auto) + reference to full file.
 */
function buildContent(cached: { summary?: string; body: string; full: string }, file: string): string {
  // User-defined summary takes priority
  if (cached.summary) {
    return `${cached.summary}\n\n> Full rules: \`read .ai/${file}\``;
  }

  // Small files: inject in full (already compact enough)
  if (cached.full.length <= COMPACT_THRESHOLD) {
    return cached.full;
  }

  // Auto-extract for larger files
  const extracted = autoExtract(cached.full);
  return `${extracted}\n\n> Full content: \`read .ai/${file}\``;
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

        sections.push({
          id: `identity:${type}:${node.name}`,
          title: file.replace('.md', ''),
          content: buildContent(cached, file),
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
