/**
 * @dot-ai/ext-file-identity — File-based identity extension.
 * Loads AGENTS.md, SOUL.md, USER.md, IDENTITY.md from .ai/
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

export default async function extFileIdentity(api: ExtensionAPI): Promise<void> {
  const nodes = discoverNodes(api.workspaceRoot, parseScanDirs('projects'));
  const rootNodes = nodes.filter(n => n.root);
  const projectNodes = nodes.filter(n => !n.root);

  api.contributeLabels(projectNodes.map(n => n.name));

  // Register identities at boot for runtime.identities accessor
  for (const node of rootNodes) {
    for (const { type, file, priority } of ROOT_FILES) {
      try {
        const content = await readFile(join(node.path, file), 'utf-8');
        api.registerIdentity({ type, content, source: 'ext-file-identity', priority, node: node.name });
      } catch { /* skip */ }
    }
  }

  api.on('context_enrich', async (event) => {
    const sections = [];

    for (const node of rootNodes) {
      for (const { type, file, priority } of ROOT_FILES) {
        try {
          const content = await readFile(join(node.path, file), 'utf-8');
          sections.push({
            id: `identity:${type}:${node.name}`,
            title: file.replace('.md', ''),
            content,
            priority,
            source: 'ext-file-identity',
            trimStrategy: 'never' as const,
          });
        } catch { /* skip */ }
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
