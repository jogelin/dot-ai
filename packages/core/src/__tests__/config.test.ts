import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, resolveConfig, injectRoot } from '../config.js';

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

  it('returns empty config when .ai directory has no dot-ai.yml', async () => {
    const config = await loadConfig('/nonexistent/path/to/workspace');
    expect(config).toEqual({});
  });

  it('parses a simple memory section', async () => {
    await writeFile(
      join(testDir, '.ai', 'dot-ai.yml'),
      `memory:\n  use: @dot-ai/ext-file-memory\n`,
      'utf-8',
    );
    const config = await loadConfig(testDir);
    expect(config.memory).toEqual({ use: '@dot-ai/ext-file-memory' });
  });

  it('parses multiple provider sections', async () => {
    await writeFile(
      join(testDir, '.ai', 'dot-ai.yml'),
      [
        'memory:',
        '  use: @dot-ai/ext-file-memory',
        'skills:',
        '  use: @dot-ai/ext-file-skills',
        'routing:',
        '  use: @dot-ai/ext-rules-routing',
      ].join('\n'),
      'utf-8',
    );
    const config = await loadConfig(testDir);
    expect(config.memory?.use).toBe('@dot-ai/ext-file-memory');
    expect(config.skills?.use).toBe('@dot-ai/ext-file-skills');
    expect(config.routing?.use).toBe('@dot-ai/ext-rules-routing');
  });

  it('parses nested with block', async () => {
    await writeFile(
      join(testDir, '.ai', 'dot-ai.yml'),
      [
        'memory:',
        '  use: @dot-ai/cockpit-memory',
        '    url: http://localhost:3010',
      ].join('\n'),
      'utf-8',
    );
    const config = await loadConfig(testDir);
    expect(config.memory?.use).toBe('@dot-ai/cockpit-memory');
    expect(config.memory?.with?.['url']).toBe('http://localhost:3010');
  });

  it('resolves ${ENV_VAR} references', async () => {
    process.env['DOT_AI_TEST_URL'] = 'http://test-server:9999';
    await writeFile(
      join(testDir, '.ai', 'dot-ai.yml'),
      [
        'memory:',
        '  use: @dot-ai/cockpit-memory',
        '    url: ${DOT_AI_TEST_URL}',
      ].join('\n'),
      'utf-8',
    );
    const config = await loadConfig(testDir);
    expect(config.memory?.with?.['url']).toBe('http://test-server:9999');
    delete process.env['DOT_AI_TEST_URL'];
  });

  it('replaces undefined ENV_VAR with empty string', async () => {
    delete process.env['MISSING_ENV_VAR'];
    await writeFile(
      join(testDir, '.ai', 'dot-ai.yml'),
      [
        'memory:',
        '  use: @dot-ai/ext-file-memory',
        '    key: ${MISSING_ENV_VAR}',
      ].join('\n'),
      'utf-8',
    );
    const config = await loadConfig(testDir);
    expect(config.memory?.with?.['key']).toBe('');
  });

  it('skips comment lines (# prefix)', async () => {
    await writeFile(
      join(testDir, '.ai', 'dot-ai.yml'),
      [
        '# This is a comment',
        'memory:',
        '  # nested comment',
        '  use: @dot-ai/ext-file-memory',
      ].join('\n'),
      'utf-8',
    );
    const config = await loadConfig(testDir);
    expect(config.memory?.use).toBe('@dot-ai/ext-file-memory');
  });
});

describe('resolveConfig', () => {
  it('returns undefined for all providers when config is empty', () => {
    const resolved = resolveConfig({});
    expect(resolved.memory).toBeUndefined();
    expect(resolved.skills).toBeUndefined();
    expect(resolved.identity).toBeUndefined();
    expect(resolved.routing).toBeUndefined();
    expect(resolved.tasks).toBeUndefined();
    expect(resolved.tools).toBeUndefined();
  });

  it('preserves existing memory config', () => {
    const resolved = resolveConfig({ memory: { use: '@dot-ai/cockpit-memory', with: { url: 'http://x' } } });
    expect(resolved.memory?.use).toBe('@dot-ai/cockpit-memory');
    expect(resolved.memory?.with?.['url']).toBe('http://x');
  });

  it('only includes explicitly configured providers', () => {
    const resolved = resolveConfig({ memory: { use: '@dot-ai/cockpit-memory' } });
    expect(resolved.memory?.use).toBe('@dot-ai/cockpit-memory');
    expect(resolved.skills).toBeUndefined();
    expect(resolved.routing).toBeUndefined();
  });

  it('preserves all six provided providers', () => {
    const full = {
      memory: { use: 'mem' },
      skills: { use: 'ski' },
      identity: { use: 'idn' },
      routing: { use: 'rte' },
      tasks: { use: 'tsk' },
      tools: { use: 'tls' },
    };
    const resolved = resolveConfig(full);
    expect(resolved.memory?.use).toBe('mem');
    expect(resolved.skills?.use).toBe('ski');
    expect(resolved.identity?.use).toBe('idn');
    expect(resolved.routing?.use).toBe('rte');
    expect(resolved.tasks?.use).toBe('tsk');
    expect(resolved.tools?.use).toBe('tls');
  });
});

describe('injectRoot', () => {
  it('injects root and nodes into provider sections', () => {
    const config = {
      memory: { use: '@dot-ai/ext-sqlite-memory' },
      skills: { use: '@dot-ai/ext-file-skills' },
    };
    const result = injectRoot(config, '/workspace');
    expect(result.memory?.with?.['root']).toBe('/workspace');
    expect(result.skills?.with?.['root']).toBe('/workspace');
    expect(result.memory?.with?.['nodes']).toBeDefined();
  });

  it('preserves existing with options', () => {
    const config = {
      memory: { use: 'test', with: { url: 'sqlite://test.db' } },
    };
    const result = injectRoot(config, '/workspace');
    expect(result.memory?.with?.['url']).toBe('sqlite://test.db');
    expect(result.memory?.with?.['root']).toBe('/workspace');
  });

  it('preserves debug, workspace, extensions, prompts sections', () => {
    const config = {
      debug: { logPath: '/tmp/log' },
      workspace: { scanDirs: 'apps' },
      extensions: { paths: ['.ai/ext'] },
      prompts: { use: 'test' },
    };
    const result = injectRoot(config, '/workspace');
    expect(result.debug?.logPath).toBe('/tmp/log');
    expect(result.workspace?.scanDirs).toBe('apps');
    expect(result.extensions?.paths).toEqual(['.ai/ext']);
    expect(result.prompts?.use).toBe('test');
  });

  it('handles empty config', () => {
    const result = injectRoot({}, '/workspace');
    expect(result).toEqual({});
  });

  it('skips unconfigured provider sections', () => {
    const config = { memory: { use: 'test' } };
    const result = injectRoot(config, '/workspace');
    expect(result.skills).toBeUndefined();
    expect(result.routing).toBeUndefined();
  });
});
