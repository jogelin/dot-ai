import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Node } from './types.js';

/**
 * Discover all .ai/ directories in a workspace.
 * Always includes root. Scans configurable directories for sub-nodes.
 *
 * @param root - workspace root (absolute path)
 * @param scanDirs - directories to scan for sub-nodes (default: ["projects"])
 */
export function discoverNodes(root: string, scanDirs: string[] = ['projects']): Node[] {
  const nodes: Node[] = [
    { name: 'root', path: join(root, '.ai'), root: true },
  ];

  for (const dir of scanDirs) {
    const scanPath = join(root, dir);
    try {
      const entries = readdirSync(scanPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const aiPath = join(scanPath, entry.name, '.ai');
        try {
          readdirSync(aiPath); // existence check
          nodes.push({ name: entry.name, path: aiPath, root: false });
        } catch {
          // No .ai/ in this directory
        }
      }
    } catch {
      // Scan directory doesn't exist
    }
  }

  return nodes;
}

/**
 * Parse scanDirs from a config string value.
 * Returns empty array if not configured.
 */
export function parseScanDirs(value: unknown): string[] {
  if (!value || typeof value !== 'string') return [];
  return value.split(',').map(s => s.trim()).filter(Boolean);
}
