import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IdentityProvider, Identity, Node, Label } from '@dot-ai/core';

// Root node identity files
const ROOT_IDENTITY_FILES: Array<{ type: string; file: string; priority: number }> = [
  { type: 'agents', file: 'AGENTS.md', priority: 100 },
  { type: 'soul', file: 'SOUL.md', priority: 90 },
  { type: 'user', file: 'USER.md', priority: 80 },
  { type: 'identity', file: 'IDENTITY.md', priority: 70 },
];

// Sub-node identity files (project-level)
const NODE_IDENTITY_FILES: Array<{ type: string; file: string; priority: number }> = [
  { type: 'agent', file: 'AGENT.md', priority: 50 },
];

export class FileIdentityProvider implements IdentityProvider {
  private rootNodes: Node[];
  private projectNodes: Node[];

  constructor(options: Record<string, unknown> = {}) {
    const root = (options.root as string) ?? process.cwd();
    const allNodes = (options.nodes as Node[]) ?? [{ name: 'root', path: join(root, '.ai'), root: true }];

    // Separate root vs project nodes
    this.rootNodes = allNodes.filter((n) => n.root);
    this.projectNodes = allNodes.filter((n) => !n.root);
  }

  /**
   * Load root identity files only (AGENTS.md, SOUL.md, USER.md, IDENTITY.md).
   * Project-level AGENT.md files are loaded lazily via match().
   */
  async load(): Promise<Identity[]> {
    const identities: Identity[] = [];

    for (const node of this.rootNodes) {
      for (const { type, file, priority } of ROOT_IDENTITY_FILES) {
        const filePath = join(node.path, file);
        try {
          const content = await readFile(filePath, 'utf-8');
          identities.push({
            type,
            content,
            source: 'file-identity',
            priority,
            node: node.name,
          });
        } catch {
          // File doesn't exist, skip
        }
      }
    }

    return identities;
  }

  /**
   * Lazily load project identities where the node name matches any of the provided labels.
   * Only loads AGENT.md files from project nodes (non-root nodes).
   */
  async match(labels: Label[]): Promise<Identity[]> {
    const labelNames = new Set(labels.map((l) => l.name));
    const identities: Identity[] = [];

    for (const node of this.projectNodes) {
      // Load this project node's AGENT.md if its name matches a label
      if (!labelNames.has(node.name)) continue;

      for (const { type, file, priority } of NODE_IDENTITY_FILES) {
        const filePath = join(node.path, file);
        try {
          const content = await readFile(filePath, 'utf-8');
          identities.push({
            type,
            content,
            source: 'file-identity',
            priority,
            node: node.name,
          });
        } catch {
          // File doesn't exist, skip
        }
      }
    }

    return identities;
  }
}
