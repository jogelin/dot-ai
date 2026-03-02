import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileMemoryProvider } from '../../providers/file-memory.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'dot-ai-test-'));
});

describe('FileMemoryProvider', () => {
  describe('search', () => {
    it('returns empty when no memory dir exists', async () => {
      const provider = new FileMemoryProvider({ root: testDir });
      const results = await provider.search('anything');
      expect(results).toEqual([]);
    });

    it('returns empty when memory dir is empty', async () => {
      await mkdir(join(testDir, '.ai', 'memory'), { recursive: true });
      const provider = new FileMemoryProvider({ root: testDir });
      const results = await provider.search('anything');
      expect(results).toEqual([]);
    });

    it('finds content by query words', async () => {
      const memDir = join(testDir, '.ai', 'memory');
      await mkdir(memDir, { recursive: true });
      await writeFile(join(memDir, '2026-01-01.md'), '- Fixed the authentication bug\n- Updated dependencies\n', 'utf-8');

      const provider = new FileMemoryProvider({ root: testDir });
      const results = await provider.search('authentication');
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('- Fixed the authentication bug');
    });

    it('finds content by labels', async () => {
      const memDir = join(testDir, '.ai', 'memory');
      await mkdir(memDir, { recursive: true });
      await writeFile(join(memDir, '2026-01-01.md'), '- Fixed the authentication bug\n- Updated dependencies\n', 'utf-8');

      const provider = new FileMemoryProvider({ root: testDir });
      const results = await provider.search('nothing matches this', ['authentication']);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('- Fixed the authentication bug');
    });

    it('returns entries sorted reverse chronologically (newest first)', async () => {
      const memDir = join(testDir, '.ai', 'memory');
      await mkdir(memDir, { recursive: true });
      await writeFile(join(memDir, '2026-01-01.md'), '- Old entry about refactoring\n', 'utf-8');
      await writeFile(join(memDir, '2026-03-01.md'), '- New entry about refactoring\n', 'utf-8');
      await writeFile(join(memDir, '2026-02-01.md'), '- Middle entry about refactoring\n', 'utf-8');

      const provider = new FileMemoryProvider({ root: testDir });
      const results = await provider.search('refactoring');
      expect(results).toHaveLength(3);
      expect(results[0].date).toBe('2026-03-01');
      expect(results[1].date).toBe('2026-02-01');
      expect(results[2].date).toBe('2026-01-01');
    });

    it('skips empty lines', async () => {
      const memDir = join(testDir, '.ai', 'memory');
      await mkdir(memDir, { recursive: true });
      await writeFile(join(memDir, '2026-01-01.md'), '\n- Found a database bug\n\n', 'utf-8');

      const provider = new FileMemoryProvider({ root: testDir });
      const results = await provider.search('database');
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('- Found a database bug');
    });

    it('returns entry with correct source and type fields', async () => {
      const memDir = join(testDir, '.ai', 'memory');
      await mkdir(memDir, { recursive: true });
      await writeFile(join(memDir, '2026-01-15.md'), '- Important log entry\n', 'utf-8');

      const provider = new FileMemoryProvider({ root: testDir });
      const results = await provider.search('important');
      expect(results[0].source).toBe('file-memory');
      expect(results[0].type).toBe('log');
      expect(results[0].date).toBe('2026-01-15');
    });

    it('does not match single-char or two-char query words', async () => {
      const memDir = join(testDir, '.ai', 'memory');
      await mkdir(memDir, { recursive: true });
      await writeFile(join(memDir, '2026-01-01.md'), '- Some content here\n', 'utf-8');

      const provider = new FileMemoryProvider({ root: testDir });
      // "is" is only 2 chars, should not match
      const results = await provider.search('is a');
      expect(results).toEqual([]);
    });
  });

  describe('store', () => {
    it('creates memory dir and writes to date-based file', async () => {
      const provider = new FileMemoryProvider({ root: testDir });
      await provider.store({ content: 'Learned something new', type: 'log', date: '2026-01-10' });

      const filePath = join(testDir, '.ai', 'memory', '2026-01-10.md');
      const content = await readFile(filePath, 'utf-8');
      expect(content).toContain('Learned something new');
    });

    it('appends to existing file', async () => {
      const memDir = join(testDir, '.ai', 'memory');
      await mkdir(memDir, { recursive: true });
      const filePath = join(memDir, '2026-01-10.md');
      await writeFile(filePath, '- First entry\n', 'utf-8');

      const provider = new FileMemoryProvider({ root: testDir });
      await provider.store({ content: 'Second entry', type: 'log', date: '2026-01-10' });

      const content = await readFile(filePath, 'utf-8');
      expect(content).toContain('First entry');
      expect(content).toContain('Second entry');
    });

    it('uses today\'s date when no date provided', async () => {
      const provider = new FileMemoryProvider({ root: testDir });
      const today = new Date().toISOString().slice(0, 10);
      await provider.store({ content: 'No date entry', type: 'log' });

      const filePath = join(testDir, '.ai', 'memory', `${today}.md`);
      const content = await readFile(filePath, 'utf-8');
      expect(content).toContain('No date entry');
    });

    it('writes line in markdown list format', async () => {
      const provider = new FileMemoryProvider({ root: testDir });
      await provider.store({ content: 'Entry content', type: 'log', date: '2026-01-10' });

      const filePath = join(testDir, '.ai', 'memory', '2026-01-10.md');
      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('- Entry content\n');
    });
  });
});
