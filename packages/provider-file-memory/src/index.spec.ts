import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileMemoryProvider } from './index.js';

describe('FileMemoryProvider.describe()', () => {
  it('returns a string containing "File-based memory"', () => {
    const provider = new FileMemoryProvider({ root: '/tmp/test' });
    const result = provider.describe();
    expect(typeof result).toBe('string');
    expect(result).toContain('File-based memory');
  });

  it('includes the node name in the description', () => {
    const provider = new FileMemoryProvider({
      nodes: [
        { name: 'root', path: '/tmp/root/.ai', root: true },
      ],
    });
    const result = provider.describe();
    expect(result).toContain('root');
  });

  it('includes all node names when multiple nodes are provided', () => {
    const provider = new FileMemoryProvider({
      nodes: [
        { name: 'root', path: '/tmp/root/.ai', root: true },
        { name: 'pro', path: '/tmp/pro/.ai', root: false },
        { name: 'cockpit', path: '/tmp/cockpit/.ai', root: false },
      ],
    });
    const result = provider.describe();
    expect(result).toContain('root');
    expect(result).toContain('pro');
    expect(result).toContain('cockpit');
  });

  it('uses default single root node when no options are provided', () => {
    const provider = new FileMemoryProvider();
    const result = provider.describe();
    expect(result).toContain('File-based memory');
    expect(result).toContain('root');
  });

  it('references memory/ directory paths in the description', () => {
    const provider = new FileMemoryProvider({
      nodes: [
        { name: 'root', path: '/tmp/root/.ai', root: true },
      ],
    });
    const result = provider.describe();
    expect(result).toContain('memory/');
  });
});

describe('FileMemoryProvider.search() — source field', () => {
  let testDir: string;

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('returns entries with source "file-memory"', async () => {
    testDir = await mkdtemp(join(tmpdir(), 'dot-ai-spec-'));
    const memDir = join(testDir, '.ai', 'memory');
    await mkdir(memDir, { recursive: true });
    await writeFile(join(memDir, '2026-01-01.md'), '- Fixed the authentication bug\n', 'utf-8');

    const provider = new FileMemoryProvider({ root: testDir });
    const results = await provider.search('authentication');

    expect(results.length).toBeGreaterThan(0);
    for (const entry of results) {
      expect(entry.source).toBe('file-memory');
    }
  });
});

describe('FileMemoryProvider store/search roundtrip', () => {
  let testDir: string;

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('stores an entry and retrieves it via search', async () => {
    testDir = await mkdtemp(join(tmpdir(), 'dot-ai-spec-'));
    const provider = new FileMemoryProvider({ root: testDir });

    await provider.store({
      content: 'Implemented the rate limiting middleware',
      type: 'log',
      date: '2026-03-01',
    });

    const results = await provider.search('rate limiting');

    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('rate limiting middleware');
    expect(results[0].source).toBe('file-memory');
    expect(results[0].date).toBe('2026-03-01');
  });

  it('stores multiple entries and retrieves the matching one', async () => {
    testDir = await mkdtemp(join(tmpdir(), 'dot-ai-spec-'));
    const provider = new FileMemoryProvider({ root: testDir });

    await provider.store({ content: 'Auth bug fixed in the login flow', type: 'log', date: '2026-03-01' });
    await provider.store({ content: 'Database migration completed successfully', type: 'log', date: '2026-03-01' });
    await provider.store({ content: 'Updated the README documentation', type: 'log', date: '2026-03-01' });

    const results = await provider.search('migration');

    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('Database migration');
  });
});
