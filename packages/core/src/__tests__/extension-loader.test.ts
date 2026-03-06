import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverExtensions } from '../extension-loader.js';

// Use temp directory for test fixtures
const testDir = join(tmpdir(), 'dot-ai-ext-test-' + Date.now());

beforeEach(async () => {
  await mkdir(join(testDir, '.ai', 'extensions'), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('discoverExtensions', () => {
  it('discovers .ts files in .ai/extensions/', async () => {
    await writeFile(join(testDir, '.ai', 'extensions', 'my-ext.ts'), 'export default function() {}');
    const paths = await discoverExtensions(testDir);
    expect(paths).toContainEqual(expect.stringContaining('my-ext.ts'));
  });

  it('discovers .js files in .ai/extensions/', async () => {
    await writeFile(join(testDir, '.ai', 'extensions', 'my-ext.js'), 'export default function() {}');
    const paths = await discoverExtensions(testDir);
    expect(paths).toContainEqual(expect.stringContaining('my-ext.js'));
  });

  it('discovers subdirs with index.ts', async () => {
    await mkdir(join(testDir, '.ai', 'extensions', 'subext'), { recursive: true });
    await writeFile(join(testDir, '.ai', 'extensions', 'subext', 'index.ts'), 'export default function() {}');
    const paths = await discoverExtensions(testDir);
    expect(paths).toContainEqual(expect.stringContaining('subext/index.ts'));
  });

  it('discovers subdirs with index.js when no index.ts', async () => {
    await mkdir(join(testDir, '.ai', 'extensions', 'jsext'), { recursive: true });
    await writeFile(join(testDir, '.ai', 'extensions', 'jsext', 'index.js'), 'export default function() {}');
    const paths = await discoverExtensions(testDir);
    expect(paths).toContainEqual(expect.stringContaining('jsext/index.js'));
  });

  it('reads dot-ai field from package.json', async () => {
    const extDir = join(testDir, '.ai', 'extensions', 'pkg-ext');
    await mkdir(extDir, { recursive: true });
    await writeFile(join(extDir, 'package.json'), JSON.stringify({
      name: 'pkg-ext',
      'dot-ai': { extensions: ['src/index.ts'] },
    }));
    await mkdir(join(extDir, 'src'), { recursive: true });
    await writeFile(join(extDir, 'src', 'index.ts'), 'export default function() {}');
    const paths = await discoverExtensions(testDir);
    expect(paths).toContainEqual(expect.stringContaining('src/index.ts'));
  });

  it('deduplicates paths', async () => {
    await writeFile(join(testDir, '.ai', 'extensions', 'dedup.ts'), 'export default function() {}');
    const paths = await discoverExtensions(testDir);
    const matching = paths.filter(p => p.includes('dedup.ts'));
    expect(matching).toHaveLength(1);
  });

  it('returns empty array when directory does not exist', async () => {
    const paths = await discoverExtensions('/nonexistent/path');
    expect(paths).toEqual([]);
  });

  it('discovers from config.paths', async () => {
    const customDir = join(testDir, 'custom-extensions');
    await mkdir(customDir, { recursive: true });
    await writeFile(join(customDir, 'custom.ts'), 'export default function() {}');
    const paths = await discoverExtensions(testDir, { paths: ['custom-extensions'] });
    expect(paths).toContainEqual(expect.stringContaining('custom.ts'));
  });

  it('ignores non .ts/.js files', async () => {
    await writeFile(join(testDir, '.ai', 'extensions', 'readme.md'), '# Readme');
    await writeFile(join(testDir, '.ai', 'extensions', 'data.json'), '{}');
    const paths = await discoverExtensions(testDir);
    expect(paths).toHaveLength(0);
  });
});
