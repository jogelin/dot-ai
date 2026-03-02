import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncToFile, unsyncFromFile } from '../sync.js';
import type { EnrichedContext } from '@dot-ai/core';

const START_MARKER = '<!-- dot-ai:start -->';
const END_MARKER = '<!-- dot-ai:end -->';

function makeCtx(overrides: Partial<EnrichedContext> = {}): EnrichedContext {
  return {
    prompt: '',
    labels: [],
    identities: [],
    memories: [],
    skills: [],
    tools: [],
    routing: { model: 'default', reason: 'no routing' },
    ...overrides,
  };
}

let tmpDir: string;
let tmpFile: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `dot-ai-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmpDir, { recursive: true });
  tmpFile = join(tmpDir, 'target.md');
});

afterEach(async () => {
  try {
    await unlink(tmpFile);
  } catch {
    // ignore
  }
});

describe('syncToFile', () => {
  it('creates file with markers when file does not exist', async () => {
    const ctx = makeCtx({
      identities: [
        { type: 'agents', content: 'Be helpful', source: 'file', priority: 10 },
      ],
    });

    await syncToFile(tmpFile, ctx);

    const content = await readFile(tmpFile, 'utf-8');
    expect(content).toContain(START_MARKER);
    expect(content).toContain(END_MARKER);
    expect(content).toContain('Be helpful');
  });

  it('replaces content between existing markers', async () => {
    const initial = `# My Rules\n\n${START_MARKER}\nOld content\n${END_MARKER}\n\nMore content\n`;
    await writeFile(tmpFile, initial, 'utf-8');

    const ctx = makeCtx({
      identities: [
        { type: 'agents', content: 'New content', source: 'file', priority: 10 },
      ],
    });

    await syncToFile(tmpFile, ctx);

    const content = await readFile(tmpFile, 'utf-8');
    expect(content).toContain('# My Rules');
    expect(content).toContain('More content');
    expect(content).toContain('New content');
    expect(content).not.toContain('Old content');
  });

  it('appends markers when file has no markers', async () => {
    const initial = '# Existing Rules\n\nSome content here.\n';
    await writeFile(tmpFile, initial, 'utf-8');

    const ctx = makeCtx({
      identities: [
        { type: 'soul', content: 'Appended content', source: 'file', priority: 5 },
      ],
    });

    await syncToFile(tmpFile, ctx);

    const content = await readFile(tmpFile, 'utf-8');
    expect(content).toContain('# Existing Rules');
    expect(content).toContain('Some content here.');
    expect(content).toContain(START_MARKER);
    expect(content).toContain(END_MARKER);
    expect(content).toContain('Appended content');
    // Existing content should come before the markers
    const existingIdx = content.indexOf('Some content here.');
    const markerIdx = content.indexOf(START_MARKER);
    expect(existingIdx).toBeLessThan(markerIdx);
  });

  it('preserves content outside markers', async () => {
    const before = '# Top Content\n\nThis stays.\n\n';
    const after = '\n\n# Bottom Content\n\nThis also stays.\n';
    const initial = `${before}${START_MARKER}\nOld\n${END_MARKER}${after}`;
    await writeFile(tmpFile, initial, 'utf-8');

    const ctx = makeCtx({
      identities: [
        { type: 'agents', content: 'Updated', source: 'file', priority: 10 },
      ],
    });

    await syncToFile(tmpFile, ctx);

    const content = await readFile(tmpFile, 'utf-8');
    expect(content).toContain('# Top Content');
    expect(content).toContain('This stays.');
    expect(content).toContain('# Bottom Content');
    expect(content).toContain('This also stays.');
    expect(content).toContain('Updated');
    expect(content).not.toContain('Old');
  });

  it('is idempotent — multiple syncs update correctly', async () => {
    const ctx1 = makeCtx({
      identities: [
        { type: 'agents', content: 'First sync', source: 'file', priority: 10 },
      ],
    });
    const ctx2 = makeCtx({
      identities: [
        { type: 'agents', content: 'Second sync', source: 'file', priority: 10 },
      ],
    });
    const ctx3 = makeCtx({
      identities: [
        { type: 'agents', content: 'Third sync', source: 'file', priority: 10 },
      ],
    });

    await syncToFile(tmpFile, ctx1);
    await syncToFile(tmpFile, ctx2);
    await syncToFile(tmpFile, ctx3);

    const content = await readFile(tmpFile, 'utf-8');
    expect(content).toContain('Third sync');
    expect(content).not.toContain('First sync');
    expect(content).not.toContain('Second sync');

    // Markers appear exactly once
    const startCount = (content.match(/<!-- dot-ai:start -->/g) ?? []).length;
    const endCount = (content.match(/<!-- dot-ai:end -->/g) ?? []).length;
    expect(startCount).toBe(1);
    expect(endCount).toBe(1);
  });

  it('appends with single newline separator when file ends with newline', async () => {
    const initial = '# Rules\n';
    await writeFile(tmpFile, initial, 'utf-8');

    await syncToFile(tmpFile, makeCtx());

    const content = await readFile(tmpFile, 'utf-8');
    // Should not have 3+ consecutive newlines
    expect(content).not.toMatch(/\n{3,}/);
  });
});

describe('unsyncFromFile', () => {
  it('removes marker content from file', async () => {
    const initial = `# My Rules\n\nKeep this.\n\n${START_MARKER}\nDot-ai content\n${END_MARKER}\n\nAlso keep this.\n`;
    await writeFile(tmpFile, initial, 'utf-8');

    await unsyncFromFile(tmpFile);

    const content = await readFile(tmpFile, 'utf-8');
    expect(content).toContain('# My Rules');
    expect(content).toContain('Keep this.');
    expect(content).toContain('Also keep this.');
    expect(content).not.toContain(START_MARKER);
    expect(content).not.toContain(END_MARKER);
    expect(content).not.toContain('Dot-ai content');
  });

  it('handles missing file gracefully', async () => {
    // Should not throw
    await expect(unsyncFromFile('/nonexistent/path/file.md')).resolves.toBeUndefined();
  });

  it('does nothing when file has no markers', async () => {
    const initial = '# My Rules\n\nContent without markers.\n';
    await writeFile(tmpFile, initial, 'utf-8');

    await unsyncFromFile(tmpFile);

    const content = await readFile(tmpFile, 'utf-8');
    expect(content).toBe(initial);
  });

  it('cleans up extra blank lines after removal', async () => {
    const initial = `Before\n\n\n${START_MARKER}\ncontent\n${END_MARKER}\n\n\nAfter\n`;
    await writeFile(tmpFile, initial, 'utf-8');

    await unsyncFromFile(tmpFile);

    const content = await readFile(tmpFile, 'utf-8');
    // Should not have 3+ consecutive newlines
    expect(content).not.toMatch(/\n{3,}/);
    expect(content).toContain('Before');
    expect(content).toContain('After');
  });
});
