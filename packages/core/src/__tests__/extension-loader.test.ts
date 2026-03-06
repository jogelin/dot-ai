import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverExtensions, loadExtensions } from '../extension-loader.js';

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

describe('loadExtensions', () => {
  it('loads extension factory and collects handlers', async () => {
    const extPath = join(testDir, '.ai', 'extensions', 'test-ext.mjs');
    await writeFile(extPath, `
      export default function(api) {
        api.on('context_inject', async (e) => ({ inject: 'hello' }));
        api.on('tool_call', async (e) => ({ decision: 'allow' }));
      }
    `);
    const loaded = await loadExtensions([extPath]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].handlers.get('context_inject')).toHaveLength(1);
    expect(loaded[0].handlers.get('tool_call')).toHaveLength(1);
  });

  it('loads extension tools', async () => {
    const extPath = join(testDir, '.ai', 'extensions', 'tool-ext.mjs');
    await writeFile(extPath, `
      export default function(api) {
        api.registerTool({
          name: 'my_tool',
          description: 'A test tool',
          parameters: {},
          execute: async () => ({ content: 'ok' }),
        });
      }
    `);
    const loaded = await loadExtensions([extPath]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].tools.has('my_tool')).toBe(true);
  });

  it('tracks extension tiers correctly', async () => {
    const extPath = join(testDir, '.ai', 'extensions', 'tier-ext.mjs');
    await writeFile(extPath, `
      export default function(api) {
        api.on('context_inject', async () => {});
        api.on('context_modify', async () => {});
      }
    `);
    const loaded = await loadExtensions([extPath]);
    expect(loaded[0].tiers.has('universal')).toBe(true);
    expect(loaded[0].tiers.has('rich')).toBe(true);
  });

  it('handles errors gracefully', async () => {
    const extPath = join(testDir, '.ai', 'extensions', 'bad-ext.mjs');
    await writeFile(extPath, 'throw new Error("broken");');
    const loaded = await loadExtensions([extPath]);
    expect(loaded).toHaveLength(0);
  });

  it('skips files with no default export function', async () => {
    const extPath = join(testDir, '.ai', 'extensions', 'no-factory.mjs');
    await writeFile(extPath, 'export const x = 42;');
    const loaded = await loadExtensions([extPath]);
    expect(loaded).toHaveLength(0);
  });

  it('returns empty array for empty paths', async () => {
    const loaded = await loadExtensions([]);
    expect(loaded).toHaveLength(0);
  });

  it('stores extension path on loaded result', async () => {
    const extPath = join(testDir, '.ai', 'extensions', 'path-ext.mjs');
    await writeFile(extPath, `
      export default function(api) {
        api.on('session_start', async () => {});
      }
    `);
    const loaded = await loadExtensions([extPath]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].path).toBe(extPath);
  });

  it('loads multiple extensions', async () => {
    const ext1 = join(testDir, '.ai', 'extensions', 'ext1.mjs');
    const ext2 = join(testDir, '.ai', 'extensions', 'ext2.mjs');
    await writeFile(ext1, `
      export default function(api) {
        api.on('context_inject', async () => ({ inject: 'one' }));
      }
    `);
    await writeFile(ext2, `
      export default function(api) {
        api.on('context_inject', async () => ({ inject: 'two' }));
      }
    `);
    const loaded = await loadExtensions([ext1, ext2]);
    expect(loaded).toHaveLength(2);
  });

  it('continues loading after one extension fails', async () => {
    const bad = join(testDir, '.ai', 'extensions', 'bad.mjs');
    const good = join(testDir, '.ai', 'extensions', 'good.mjs');
    await writeFile(bad, 'throw new Error("broken");');
    await writeFile(good, `
      export default function(api) {
        api.on('session_start', async () => {});
      }
    `);
    const loaded = await loadExtensions([bad, good]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].path).toBe(good);
  });
});
