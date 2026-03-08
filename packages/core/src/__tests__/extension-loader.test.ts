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
  // ── Auto-discovery: .ai/extensions/ ──────────────────────────────────

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

  it('reads dot-ai field from package.json in subdirectory', async () => {
    const extDir = join(testDir, '.ai', 'extensions', 'pkg-ext');
    await mkdir(join(extDir, 'src'), { recursive: true });
    await writeFile(join(extDir, 'package.json'), JSON.stringify({
      name: 'pkg-ext',
      'dot-ai': { extensions: ['src/index.ts'] },
    }));
    await writeFile(join(extDir, 'src', 'index.ts'), 'export default function() {}');
    const paths = await discoverExtensions(testDir);
    expect(paths).toContainEqual(expect.stringContaining('src/index.ts'));
  });

  it('ignores non .ts/.js files', async () => {
    await writeFile(join(testDir, '.ai', 'extensions', 'readme.md'), '# Readme');
    await writeFile(join(testDir, '.ai', 'extensions', 'data.json'), '{}');
    const paths = await discoverExtensions(testDir);
    expect(paths).toHaveLength(0);
  });

  it('returns empty array when directory does not exist', async () => {
    const paths = await discoverExtensions('/nonexistent/path');
    expect(paths).toEqual([]);
  });

  // ── Deduplication ────────────────────────────────────────────────────

  it('deduplicates paths', async () => {
    await writeFile(join(testDir, '.ai', 'extensions', 'dedup.ts'), 'export default function() {}');
    const paths = await discoverExtensions(testDir);
    const matching = paths.filter(p => p.includes('dedup.ts'));
    expect(matching).toHaveLength(1);
  });

  // ── Configured paths (settings.json "extensions") ────────────────────

  it('discovers from config.paths (directory)', async () => {
    const customDir = join(testDir, 'custom-extensions');
    await mkdir(customDir, { recursive: true });
    await writeFile(join(customDir, 'custom.ts'), 'export default function() {}');
    const paths = await discoverExtensions(testDir, { paths: ['custom-extensions'] });
    expect(paths).toContainEqual(expect.stringContaining('custom.ts'));
  });

  it('discovers from config.paths (directory with package.json)', async () => {
    const customDir = join(testDir, 'my-package');
    await mkdir(join(customDir, 'dist'), { recursive: true });
    await writeFile(join(customDir, 'package.json'), JSON.stringify({
      name: 'my-package',
      'dot-ai': { extensions: ['dist/index.js'] },
    }));
    await writeFile(join(customDir, 'dist', 'index.js'), 'export default function() {}');
    const paths = await discoverExtensions(testDir, { paths: ['my-package'] });
    expect(paths).toContainEqual(expect.stringContaining('dist/index.js'));
  });

  it('discovers from config.paths (direct file)', async () => {
    const customFile = join(testDir, 'standalone.ts');
    await writeFile(customFile, 'export default function() {}');
    const paths = await discoverExtensions(testDir, { paths: ['standalone.ts'] });
    expect(paths).toContainEqual(expect.stringContaining('standalone.ts'));
  });

  // ── Installed packages (.ai/packages/) ───────────────────────────────

  it('discovers extensions from .ai/packages/node_modules/', async () => {
    const pkgDir = join(testDir, '.ai', 'packages');
    const extPkgDir = join(pkgDir, 'node_modules', '@dot-ai', 'ext-file-memory');
    await mkdir(join(extPkgDir, 'dist'), { recursive: true });

    // Create the packages/package.json (npm --prefix creates this)
    await writeFile(join(pkgDir, 'package.json'), JSON.stringify({
      dependencies: { '@dot-ai/ext-file-memory': '0.10.0' },
    }));

    // Create the installed package with dot-ai field
    await writeFile(join(extPkgDir, 'package.json'), JSON.stringify({
      name: '@dot-ai/ext-file-memory',
      version: '0.10.0',
      'dot-ai': { extensions: ['./dist/extension.js'] },
    }));
    await writeFile(join(extPkgDir, 'dist', 'extension.js'), 'export default function() {}');

    const paths = await discoverExtensions(testDir);
    expect(paths).toContainEqual(expect.stringContaining('ext-file-memory/dist/extension.js'));
  });

  it('discovers multiple packages from .ai/packages/', async () => {
    const pkgDir = join(testDir, '.ai', 'packages');
    await mkdir(pkgDir, { recursive: true });

    // Create packages/package.json with two deps
    await writeFile(join(pkgDir, 'package.json'), JSON.stringify({
      dependencies: {
        '@dot-ai/ext-file-memory': '0.10.0',
        '@dot-ai/ext-file-identity': '0.10.0',
      },
    }));

    // ext-file-memory
    const memDir = join(pkgDir, 'node_modules', '@dot-ai', 'ext-file-memory');
    await mkdir(join(memDir, 'dist'), { recursive: true });
    await writeFile(join(memDir, 'package.json'), JSON.stringify({
      name: '@dot-ai/ext-file-memory',
      'dot-ai': { extensions: ['./dist/extension.js'] },
    }));
    await writeFile(join(memDir, 'dist', 'extension.js'), 'export default function() {}');

    // ext-file-identity
    const idDir = join(pkgDir, 'node_modules', '@dot-ai', 'ext-file-identity');
    await mkdir(join(idDir, 'dist'), { recursive: true });
    await writeFile(join(idDir, 'package.json'), JSON.stringify({
      name: '@dot-ai/ext-file-identity',
      'dot-ai': { extensions: ['./dist/index.js'] },
    }));
    await writeFile(join(idDir, 'dist', 'index.js'), 'export default function() {}');

    const paths = await discoverExtensions(testDir);
    expect(paths).toContainEqual(expect.stringContaining('ext-file-memory/dist/extension.js'));
    expect(paths).toContainEqual(expect.stringContaining('ext-file-identity/dist/index.js'));
  });

  it('ignores .ai/packages/ when no package.json exists', async () => {
    // No .ai/packages/package.json at all
    const paths = await discoverExtensions(testDir);
    expect(paths).toHaveLength(0);
  });

  it('ignores packages without dot-ai field', async () => {
    const pkgDir = join(testDir, '.ai', 'packages');
    const noDotAiDir = join(pkgDir, 'node_modules', 'some-lib');
    await mkdir(noDotAiDir, { recursive: true });

    await writeFile(join(pkgDir, 'package.json'), JSON.stringify({
      dependencies: { 'some-lib': '1.0.0' },
    }));
    await writeFile(join(noDotAiDir, 'package.json'), JSON.stringify({
      name: 'some-lib',
      version: '1.0.0',
    }));

    const paths = await discoverExtensions(testDir);
    expect(paths).toHaveLength(0);
  });

  // ── Combined sources ─────────────────────────────────────────────────

  it('merges auto-discovered and installed package extensions', async () => {
    // Auto-discovered in .ai/extensions/
    await writeFile(join(testDir, '.ai', 'extensions', 'local.ts'), 'export default function() {}');

    // Installed package in .ai/packages/
    const pkgDir = join(testDir, '.ai', 'packages');
    const extPkgDir = join(pkgDir, 'node_modules', 'my-ext');
    await mkdir(join(extPkgDir, 'dist'), { recursive: true });
    await writeFile(join(pkgDir, 'package.json'), JSON.stringify({
      dependencies: { 'my-ext': '1.0.0' },
    }));
    await writeFile(join(extPkgDir, 'package.json'), JSON.stringify({
      name: 'my-ext',
      'dot-ai': { extensions: ['./dist/index.js'] },
    }));
    await writeFile(join(extPkgDir, 'dist', 'index.js'), 'export default function() {}');

    const paths = await discoverExtensions(testDir);
    expect(paths).toContainEqual(expect.stringContaining('local.ts'));
    expect(paths).toContainEqual(expect.stringContaining('my-ext/dist/index.js'));
    expect(paths).toHaveLength(2);
  });

  it('deduplicates across sources', async () => {
    // Same extension in both .ai/extensions/ and config.paths
    const extDir = join(testDir, '.ai', 'extensions');
    await writeFile(join(extDir, 'shared.ts'), 'export default function() {}');

    const paths = await discoverExtensions(testDir, {
      paths: [join(testDir, '.ai', 'extensions', 'shared.ts')],
    });
    const matching = paths.filter(p => p.includes('shared.ts'));
    expect(matching).toHaveLength(1);
  });

  it('skips config.packages already loaded from .ai/packages/', async () => {
    // Setup package in .ai/packages/ (step 3)
    const pkgDir = join(testDir, '.ai', 'packages');
    const extPkgDir = join(pkgDir, 'node_modules', '@dot-ai', 'ext-file-skills');
    await mkdir(join(extPkgDir, 'dist'), { recursive: true });
    await writeFile(join(pkgDir, 'package.json'), JSON.stringify({
      dependencies: { '@dot-ai/ext-file-skills': '0.13.0' },
    }));
    await writeFile(join(extPkgDir, 'package.json'), JSON.stringify({
      name: '@dot-ai/ext-file-skills',
      version: '0.13.0',
      'dot-ai': { extensions: ['./dist/index.js'] },
    }));
    await writeFile(join(extPkgDir, 'dist', 'index.js'), 'export default function() {}');

    // config.packages lists the same package (step 5) — should be skipped
    const paths = await discoverExtensions(testDir, {
      packages: ['@dot-ai/ext-file-skills'],
    });

    // Should only appear once (from .ai/packages/, not from config.packages)
    const matching = paths.filter(p => p.includes('ext-file-skills'));
    expect(matching).toHaveLength(1);
    expect(matching[0]).toContain('.ai/packages/');
  });
});
