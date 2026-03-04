import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverNodes, parseScanDirs } from '../nodes.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dot-ai-nodes-'));
});

describe('discoverNodes', () => {
  it('returns root node even if .ai/ does not exist', () => {
    const nodes = discoverNodes(root);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe('root');
    expect(nodes[0].root).toBe(true);
  });

  it('discovers sub-nodes in projects/ directory', async () => {
    await mkdir(join(root, '.ai'), { recursive: true });
    await mkdir(join(root, 'projects', 'pro', '.ai'), { recursive: true });
    await mkdir(join(root, 'projects', 'cockpit', '.ai'), { recursive: true });
    // This project has no .ai/ — should be skipped
    await mkdir(join(root, 'projects', 'no-ai'), { recursive: true });

    const nodes = discoverNodes(root);
    expect(nodes).toHaveLength(3); // root + pro + cockpit
    expect(nodes.map(n => n.name).sort()).toEqual(['cockpit', 'pro', 'root']);
    expect(nodes.find(n => n.name === 'pro')?.root).toBe(false);
  });

  it('supports custom scanDirs', async () => {
    await mkdir(join(root, '.ai'), { recursive: true });
    await mkdir(join(root, 'apps', 'web', '.ai'), { recursive: true });

    const nodes = discoverNodes(root, ['apps']);
    expect(nodes).toHaveLength(2);
    expect(nodes[1].name).toBe('web');
  });

  it('handles multiple scanDirs', async () => {
    await mkdir(join(root, '.ai'), { recursive: true });
    await mkdir(join(root, 'projects', 'a', '.ai'), { recursive: true });
    await mkdir(join(root, 'apps', 'b', '.ai'), { recursive: true });

    const nodes = discoverNodes(root, ['projects', 'apps']);
    expect(nodes).toHaveLength(3);
  });

  it('returns only root when scanDirs is empty', async () => {
    await mkdir(join(root, '.ai'), { recursive: true });
    await mkdir(join(root, 'projects', 'pro', '.ai'), { recursive: true });

    const nodes = discoverNodes(root, []);
    expect(nodes).toHaveLength(1);
  });

  it('ignores non-directory entries in scan path', async () => {
    await mkdir(join(root, '.ai'), { recursive: true });
    await mkdir(join(root, 'projects'), { recursive: true });
    await writeFile(join(root, 'projects', 'not-a-dir'), 'hello');

    const nodes = discoverNodes(root);
    expect(nodes).toHaveLength(1); // only root
  });

  it('node paths point to .ai/ directory', async () => {
    await mkdir(join(root, '.ai'), { recursive: true });
    await mkdir(join(root, 'projects', 'pro', '.ai'), { recursive: true });

    const nodes = discoverNodes(root);
    const pro = nodes.find(n => n.name === 'pro');
    expect(pro?.path).toBe(join(root, 'projects', 'pro', '.ai'));
  });
});

describe('parseScanDirs', () => {
  it('returns empty for undefined', () => {
    expect(parseScanDirs(undefined)).toEqual([]);
  });

  it('returns empty for empty string', () => {
    expect(parseScanDirs('')).toEqual([]);
  });

  it('parses single value', () => {
    expect(parseScanDirs('projects')).toEqual(['projects']);
  });

  it('parses comma-separated values', () => {
    expect(parseScanDirs('projects, apps')).toEqual(['projects', 'apps']);
  });

  it('trims whitespace', () => {
    expect(parseScanDirs('  projects , apps  ')).toEqual(['projects', 'apps']);
  });

  it('filters empty values', () => {
    expect(parseScanDirs('projects,,apps')).toEqual(['projects', 'apps']);
  });
});
