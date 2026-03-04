import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IdentityProvider, Identity, Node } from '@dot-ai/core';

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
  private nodes: Node[];

  constructor(options: Record<string, unknown> = {}) {
    const root = (options.root as string) ?? process.cwd();
    this.nodes = (options.nodes as Node[]) ?? [{ name: 'root', path: join(root, '.ai'), root: true }];
  }

  async load(): Promise<Identity[]> {
    const identities: Identity[] = [];

    for (const node of this.nodes) {
      const files = node.root ? ROOT_IDENTITY_FILES : NODE_IDENTITY_FILES;

      for (const { type, file, priority } of files) {
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
