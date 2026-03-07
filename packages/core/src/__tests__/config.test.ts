import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config.js';

// Mock homedir to isolate tests from user's real ~/.ai/settings.json
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => '/tmp/dot-ai-test-no-home',
  };
});

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'dot-ai-test-'));
  await mkdir(join(testDir, '.ai'), { recursive: true });
});

describe('loadConfig', () => {
  it('returns empty config when no file exists', async () => {
    const config = await loadConfig(testDir);
    expect(config).toEqual({});
  });

  it('returns empty config for nonexistent workspace', async () => {
    const config = await loadConfig('/nonexistent/path/to/workspace');
    expect(config).toEqual({});
  });

  it('loads settings.json with extensions', async () => {
    await writeFile(
      join(testDir, '.ai', 'settings.json'),
      JSON.stringify({
        extensions: ['.ai/extensions/custom.ts'],
        packages: ['npm:@dot-ai/ext-memory@1.0.0'],
      }),
      'utf-8',
    );
    const config = await loadConfig(testDir);
    expect(config.extensions?.paths).toEqual(['.ai/extensions/custom.ts']);
    expect(config.extensions?.packages).toEqual(['npm:@dot-ai/ext-memory@1.0.0']);
  });

  it('loads settings.json with debug section', async () => {
    await writeFile(
      join(testDir, '.ai', 'settings.json'),
      JSON.stringify({ debug: { logPath: '/tmp/log' } }),
      'utf-8',
    );
    const config = await loadConfig(testDir);
    expect(config.debug?.logPath).toBe('/tmp/log');
  });

  it('loads settings.json with workspace section', async () => {
    await writeFile(
      join(testDir, '.ai', 'settings.json'),
      JSON.stringify({ workspace: { scanDirs: 'apps,libs' } }),
      'utf-8',
    );
    const config = await loadConfig(testDir);
    expect(config.workspace?.scanDirs).toBe('apps,libs');
  });

  it('handles empty settings.json', async () => {
    await writeFile(
      join(testDir, '.ai', 'settings.json'),
      '{}',
      'utf-8',
    );
    const config = await loadConfig(testDir);
    expect(config).toEqual({});
  });
});

describe('loadConfig — global + project merge', () => {
  let globalDir: string;
  let projectDir: string;

  beforeEach(async () => {
    globalDir = await mkdtemp(join(tmpdir(), 'dot-ai-global-'));
    projectDir = await mkdtemp(join(tmpdir(), 'dot-ai-project-'));
    await mkdir(join(globalDir, '.ai'), { recursive: true });
    await mkdir(join(projectDir, '.ai'), { recursive: true });
  });

  it('merges global and project packages (deduplicated)', async () => {
    // Override homedir mock for this test
    const os = await import('node:os');
    vi.spyOn(os, 'homedir').mockReturnValue(globalDir);

    await writeFile(
      join(globalDir, '.ai', 'settings.json'),
      JSON.stringify({ packages: ['@dot-ai/ext-file-identity', '@dot-ai/ext-file-memory'] }),
    );
    await writeFile(
      join(projectDir, '.ai', 'settings.json'),
      JSON.stringify({ packages: ['@dot-ai/ext-file-memory', '@dot-ai/ext-sqlite-memory'] }),
    );

    const config = await loadConfig(projectDir);
    expect(config.extensions?.packages).toEqual([
      '@dot-ai/ext-file-identity',
      '@dot-ai/ext-file-memory',
      '@dot-ai/ext-sqlite-memory',
    ]);
  });

  it('merges global and project extension paths', async () => {
    const os = await import('node:os');
    vi.spyOn(os, 'homedir').mockReturnValue(globalDir);

    await writeFile(
      join(globalDir, '.ai', 'settings.json'),
      JSON.stringify({ extensions: ['~/.ai/extensions/global.ts'] }),
    );
    await writeFile(
      join(projectDir, '.ai', 'settings.json'),
      JSON.stringify({ extensions: ['.ai/extensions/local.ts'] }),
    );

    const config = await loadConfig(projectDir);
    expect(config.extensions?.paths).toEqual([
      '~/.ai/extensions/global.ts',
      '.ai/extensions/local.ts',
    ]);
  });

  it('project debug overrides global debug', async () => {
    const os = await import('node:os');
    vi.spyOn(os, 'homedir').mockReturnValue(globalDir);

    await writeFile(
      join(globalDir, '.ai', 'settings.json'),
      JSON.stringify({ debug: { logPath: '/tmp/global.log' } }),
    );
    await writeFile(
      join(projectDir, '.ai', 'settings.json'),
      JSON.stringify({ debug: { logPath: '/tmp/project.log' } }),
    );

    const config = await loadConfig(projectDir);
    expect(config.debug?.logPath).toBe('/tmp/project.log');
  });

  it('uses global config when no project config exists', async () => {
    const os = await import('node:os');
    vi.spyOn(os, 'homedir').mockReturnValue(globalDir);

    await writeFile(
      join(globalDir, '.ai', 'settings.json'),
      JSON.stringify({ packages: ['@dot-ai/ext-file-identity'] }),
    );

    const config = await loadConfig(projectDir);
    expect(config.extensions?.packages).toEqual(['@dot-ai/ext-file-identity']);
  });

  it('uses project config when no global config exists', async () => {
    const os = await import('node:os');
    vi.spyOn(os, 'homedir').mockReturnValue('/tmp/dot-ai-no-global');

    await writeFile(
      join(projectDir, '.ai', 'settings.json'),
      JSON.stringify({ packages: ['@dot-ai/ext-sqlite-memory'] }),
    );

    const config = await loadConfig(projectDir);
    expect(config.extensions?.packages).toEqual(['@dot-ai/ext-sqlite-memory']);
  });
});
