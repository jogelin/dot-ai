import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config.js';

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
