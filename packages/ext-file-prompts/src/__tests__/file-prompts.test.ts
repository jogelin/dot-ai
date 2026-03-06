import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { FilePromptProvider } from '../file-prompts.js';

let testDir: string;
let promptsDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), 'dot-ai-prompts-test-' + randomUUID());
  promptsDir = join(testDir, '.ai', 'prompts');
  await mkdir(promptsDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('FilePromptProvider', () => {
  it('lists prompt files from .ai/prompts/', async () => {
    await writeFile(join(promptsDir, 'fix-bug.md'), 'Fix the bug in $file');
    const provider = new FilePromptProvider({ root: testDir });
    const templates = await provider.list();
    expect(templates).toHaveLength(1);
    expect(templates[0].name).toBe('fix-bug');
  });

  it('loads a prompt by name', async () => {
    await writeFile(join(promptsDir, 'review.md'), 'Review the code');
    const provider = new FilePromptProvider({ root: testDir });
    const content = await provider.load('review');
    expect(content).toBe('Review the code');
  });

  it('returns null for unknown prompt', async () => {
    const provider = new FilePromptProvider({ root: testDir });
    const content = await provider.load('nonexistent');
    expect(content).toBeNull();
  });

  it('parses frontmatter', async () => {
    await writeFile(join(promptsDir, 'debug.md'), [
      '---',
      'description: Debug an issue',
      'args: [file, issue]',
      '---',
      'Debug the $issue in $file',
    ].join('\n'));

    const provider = new FilePromptProvider({ root: testDir });
    const templates = await provider.list();
    expect(templates[0].description).toBe('Debug an issue');
    expect(templates[0].args).toEqual(['file', 'issue']);
    expect(templates[0].content).toBe('Debug the $issue in $file');
  });

  it('detects $args in content without frontmatter', async () => {
    await writeFile(join(promptsDir, 'simple.md'), 'Fix $file with $strategy');
    const provider = new FilePromptProvider({ root: testDir });
    const templates = await provider.list();
    expect(templates[0].args).toContain('file');
    expect(templates[0].args).toContain('strategy');
  });

  it('caches results', async () => {
    await writeFile(join(promptsDir, 'cached.md'), 'Test caching');
    const provider = new FilePromptProvider({ root: testDir });
    const first = await provider.list();
    const second = await provider.list();
    expect(first).toBe(second); // Same reference
  });

  it('handles missing directory', async () => {
    const provider = new FilePromptProvider({ root: '/nonexistent/path' });
    const templates = await provider.list();
    expect(templates).toEqual([]);
  });

  it('supports custom dirs option', async () => {
    const customDir = join(testDir, 'custom-prompts');
    await mkdir(customDir, { recursive: true });
    await writeFile(join(customDir, 'test.md'), 'Custom prompt');

    const provider = new FilePromptProvider({ root: testDir, dirs: 'custom-prompts' });
    const templates = await provider.list();
    expect(templates).toHaveLength(1);
  });

  it('supports array of dirs', async () => {
    const dir1 = join(testDir, 'prompts1');
    const dir2 = join(testDir, 'prompts2');
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });
    await writeFile(join(dir1, 'a.md'), 'Prompt A');
    await writeFile(join(dir2, 'b.md'), 'Prompt B');

    const provider = new FilePromptProvider({ root: testDir, dirs: ['prompts1', 'prompts2'] });
    const templates = await provider.list();
    expect(templates).toHaveLength(2);
  });
});
