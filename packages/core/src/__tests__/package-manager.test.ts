import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  listPackages,
  resolvePackages,
  ensurePackagesInstalled,
} from '../package-manager.js';

// Use temp directory for test fixtures
const testDir = join(tmpdir(), 'dot-ai-pkg-test-' + Date.now());

beforeEach(async () => {
  await mkdir(join(testDir, '.ai', 'packages'), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── Helper: create a fake installed package ─────────────────────────────────
async function createFakePackage(
  name: string,
  version: string,
  dotAi?: { extensions?: string[] },
) {
  const installDir = join(testDir, '.ai', 'packages');
  const pkgDir = join(installDir, 'node_modules', name);
  await mkdir(pkgDir, { recursive: true });

  // Write package.json for installed package
  const pkgJson: Record<string, unknown> = { name, version };
  if (dotAi) pkgJson['dot-ai'] = dotAi;
  await writeFile(join(pkgDir, 'package.json'), JSON.stringify(pkgJson));

  // Create extension files if declared
  if (dotAi?.extensions) {
    for (const ext of dotAi.extensions) {
      const extPath = join(pkgDir, ext);
      await mkdir(join(extPath, '..'), { recursive: true });
      await writeFile(extPath, 'export default function() {}');
    }
  }

  // Update the packages/package.json dependencies
  const depsPkgPath = join(installDir, 'package.json');
  let deps: Record<string, string> = {};
  try {
    const raw = await readFile(depsPkgPath, 'utf-8');
    const existing = JSON.parse(raw);
    deps = existing.dependencies ?? {};
  } catch { /* no file yet */ }

  deps[name] = version;
  await writeFile(depsPkgPath, JSON.stringify({ dependencies: deps }));
}

describe('listPackages', () => {
  it('returns empty array when no packages installed', async () => {
    const result = await listPackages(testDir);
    expect(result).toEqual([]);
  });

  it('lists installed packages with dot-ai field', async () => {
    await createFakePackage('@dot-ai/ext-memory', '1.0.0', {
      extensions: ['./dist/extension.js'],
    });

    const result = await listPackages(testDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('@dot-ai/ext-memory');
    expect(result[0].version).toBe('1.0.0');
    expect(result[0].dotAi?.extensions).toEqual(['./dist/extension.js']);
  });

  it('lists packages without dot-ai field', async () => {
    await createFakePackage('some-lib', '2.0.0');

    const result = await listPackages(testDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('some-lib');
    expect(result[0].dotAi).toBeUndefined();
  });

  it('lists multiple packages', async () => {
    await createFakePackage('@dot-ai/ext-memory', '1.0.0', {
      extensions: ['./dist/extension.js'],
    });
    await createFakePackage('@dot-ai/ext-identity', '1.0.0', {
      extensions: ['./dist/index.js'],
    });

    const result = await listPackages(testDir);
    expect(result).toHaveLength(2);
  });
});

describe('resolvePackages', () => {
  it('returns empty when no packages', async () => {
    const result = await resolvePackages(testDir);
    expect(result.extensions).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.providers).toEqual([]);
  });

  it('resolves extension paths from packages with dot-ai field', async () => {
    await createFakePackage('@dot-ai/ext-memory', '1.0.0', {
      extensions: ['./dist/extension.js'],
    });

    const result = await resolvePackages(testDir);
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0]).toContain('ext-memory');
    expect(result.extensions[0]).toContain('dist/extension.js');
  });

  it('skips packages without dot-ai field', async () => {
    await createFakePackage('some-lib', '2.0.0');

    const result = await resolvePackages(testDir);
    expect(result.extensions).toHaveLength(0);
  });
});

describe('ensurePackagesInstalled', () => {
  it('skips already installed packages', async () => {
    await createFakePackage('@dot-ai/ext-memory', '1.0.0', {
      extensions: ['./dist/extension.js'],
    });

    const result = await ensurePackagesInstalled(
      testDir,
      ['@dot-ai/ext-memory'],
    );

    expect(result.skipped).toContain('@dot-ai/ext-memory');
    expect(result.installed).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('skips packages when onMissing returns skip', async () => {
    const result = await ensurePackagesInstalled(
      testDir,
      ['@dot-ai/ext-not-there'],
      async () => 'skip',
    );

    expect(result.skipped).toContain('@dot-ai/ext-not-there');
    expect(result.installed).toHaveLength(0);
  });

  it('errors when onMissing returns error', async () => {
    const result = await ensurePackagesInstalled(
      testDir,
      ['@dot-ai/ext-not-there'],
      async () => 'error',
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].source).toBe('@dot-ai/ext-not-there');
    expect(result.errors[0].error).toContain('Missing package');
  });

  it('reports errors for failed installs', async () => {
    // Use an impossible package name that npm will fail to find
    const result = await ensurePackagesInstalled(
      testDir,
      ['@dot-ai-fake-nonexistent-pkg-xyz/no-exist'],
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].source).toBe('@dot-ai-fake-nonexistent-pkg-xyz/no-exist');
  });

  it('handles npm: prefix in source', async () => {
    await createFakePackage('@dot-ai/ext-memory', '1.0.0', {
      extensions: ['./dist/extension.js'],
    });

    const result = await ensurePackagesInstalled(
      testDir,
      ['npm:@dot-ai/ext-memory@1.0.0'],
    );

    // npm:@dot-ai/ext-memory@1.0.0 → name = @dot-ai/ext-memory → already installed
    expect(result.skipped).toContain('npm:@dot-ai/ext-memory@1.0.0');
  });

  it('handles multiple packages', async () => {
    await createFakePackage('@dot-ai/ext-memory', '1.0.0', {
      extensions: ['./dist/extension.js'],
    });

    const result = await ensurePackagesInstalled(
      testDir,
      ['@dot-ai/ext-memory', '@dot-ai/ext-not-there'],
      async (source) => source.includes('not-there') ? 'skip' : 'install',
    );

    expect(result.skipped).toContain('@dot-ai/ext-memory');
    expect(result.skipped).toContain('@dot-ai/ext-not-there');
  });
});

describe('parsePackageSource (via ensurePackagesInstalled)', () => {
  // We test parsePackageSource indirectly through ensurePackagesInstalled

  it('handles scoped package with version', async () => {
    await createFakePackage('@dot-ai/ext-memory', '1.0.0');

    const result = await ensurePackagesInstalled(testDir, ['@dot-ai/ext-memory@1.0.0']);
    // Should find it as already installed (strips version to get name)
    expect(result.skipped).toContain('@dot-ai/ext-memory@1.0.0');
  });

  it('handles scoped package without version', async () => {
    await createFakePackage('@dot-ai/ext-memory', '1.0.0');

    const result = await ensurePackagesInstalled(testDir, ['@dot-ai/ext-memory']);
    expect(result.skipped).toContain('@dot-ai/ext-memory');
  });

  it('handles unscoped package with version', async () => {
    await createFakePackage('my-ext', '2.0.0');

    const result = await ensurePackagesInstalled(testDir, ['my-ext@2.0.0']);
    expect(result.skipped).toContain('my-ext@2.0.0');
  });

  it('handles npm: prefix with scoped package', async () => {
    await createFakePackage('@dot-ai/ext-memory', '1.0.0');

    const result = await ensurePackagesInstalled(testDir, ['npm:@dot-ai/ext-memory']);
    expect(result.skipped).toContain('npm:@dot-ai/ext-memory');
  });
});
