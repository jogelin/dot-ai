import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IdentityProvider } from '../contracts.js';
import type { Identity } from '../types.js';

const IDENTITY_FILES: Array<{ type: string; file: string; priority: number }> = [
  { type: 'agents', file: 'AGENTS.md', priority: 100 },
  { type: 'soul', file: 'SOUL.md', priority: 90 },
  { type: 'user', file: 'USER.md', priority: 80 },
  { type: 'identity', file: 'IDENTITY.md', priority: 70 },
];

export class FileIdentityProvider implements IdentityProvider {
  private aiDir: string;

  constructor(options: Record<string, unknown> = {}) {
    const root = (options.root as string) ?? process.cwd();
    this.aiDir = join(root, '.ai');
  }

  async load(): Promise<Identity[]> {
    const identities: Identity[] = [];

    for (const { type, file, priority } of IDENTITY_FILES) {
      const filePath = join(this.aiDir, file);
      try {
        const content = await readFile(filePath, 'utf-8');
        identities.push({
          type,
          content,
          source: 'file-identity',
          priority,
        });
      } catch {
        // File doesn't exist, skip
      }
    }

    return identities;
  }
}
