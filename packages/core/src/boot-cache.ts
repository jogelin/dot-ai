import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * Cached boot data — vocabulary, extension paths, tool schemas.
 * Stored at .ai/.cache/boot.json for fast hook startup.
 */
export interface BootCacheData {
  /** Cache format version */
  version: 1;
  /** Checksum of inputs that produced this cache */
  checksum: string;
  /** Label vocabulary from registered resources */
  vocabulary: string[];
  /** Extension paths that were loaded */
  extensionPaths: string[];
  /** Tool names + descriptions from registered tools */
  tools: Array<{ name: string; description: string }>;
  /** Timestamp of cache creation */
  createdAt: string;
}

const CACHE_DIR = '.ai/.cache';
const CACHE_FILE = 'boot.json';

/**
 * Compute a checksum from file modification times.
 * Used to invalidate the cache when extensions or config change.
 */
export async function computeChecksum(
  workspaceRoot: string,
  extensionPaths: string[],
): Promise<string> {
  const hash = createHash('sha256');

  // Include settings.json mtime (or dot-ai.yml)
  for (const configName of ['settings.json', 'dot-ai.yml']) {
    try {
      const s = await stat(join(workspaceRoot, '.ai', configName));
      hash.update(`config:${configName}:${s.mtimeMs}`);
    } catch { /* not found */ }
  }

  // Include .ai/extensions/ dir mtime
  try {
    const s = await stat(join(workspaceRoot, '.ai', 'extensions'));
    hash.update(`extdir:${s.mtimeMs}`);
  } catch { /* not found */ }

  // Include each extension file's mtime
  for (const extPath of extensionPaths.sort()) {
    try {
      const s = await stat(extPath);
      hash.update(`ext:${extPath}:${s.mtimeMs}`);
    } catch { /* not found */ }
  }

  return hash.digest('hex').slice(0, 16);
}

/**
 * Try to load cached boot data.
 * Returns null if cache is missing, invalid, or checksum doesn't match.
 */
export async function loadBootCache(
  workspaceRoot: string,
  currentChecksum: string,
): Promise<BootCacheData | null> {
  try {
    const cachePath = join(workspaceRoot, CACHE_DIR, CACHE_FILE);
    const raw = await readFile(cachePath, 'utf-8');
    const data = JSON.parse(raw) as BootCacheData;

    if (data.version !== 1) return null;
    if (data.checksum !== currentChecksum) return null;

    return data;
  } catch {
    return null;
  }
}

/**
 * Write boot cache to disk.
 */
export async function writeBootCache(
  workspaceRoot: string,
  data: BootCacheData,
): Promise<void> {
  const cacheDir = join(workspaceRoot, CACHE_DIR);
  await mkdir(cacheDir, { recursive: true });
  const cachePath = join(cacheDir, CACHE_FILE);
  await writeFile(cachePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Clear the boot cache.
 */
export async function clearBootCache(workspaceRoot: string): Promise<void> {
  const { rm } = await import('node:fs/promises');
  const cacheDir = join(workspaceRoot, CACHE_DIR);
  await rm(cacheDir, { recursive: true, force: true });
}
