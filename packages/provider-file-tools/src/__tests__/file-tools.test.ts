import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileToolProvider } from '../index.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'dot-ai-test-'));
});

const TOOL_YAML = `name: web-search
description: Search the web for information
labels: [search, web, research]
`;

const TOOL_YAML_B = `name: code-runner
description: Execute code snippets
labels: [code, execution, dev]
`;

const TOOL_YAML_MINIMAL = `description: Minimal tool without explicit name
labels: [misc]
`;

async function createTool(dir: string, filename: string, content: string): Promise<void> {
  const toolsDir = join(dir, '.ai', 'tools');
  await mkdir(toolsDir, { recursive: true });
  await writeFile(join(toolsDir, filename), content, 'utf-8');
}

describe('FileToolProvider', () => {
  describe('list', () => {
    it('returns empty when no tools dir', async () => {
      const provider = new FileToolProvider({ root: testDir });
      const tools = await provider.list();
      expect(tools).toEqual([]);
    });

    it('returns empty when tools dir is empty', async () => {
      await mkdir(join(testDir, '.ai', 'tools'), { recursive: true });
      const provider = new FileToolProvider({ root: testDir });
      const tools = await provider.list();
      expect(tools).toEqual([]);
    });

    it('parses tool YAML files (.yaml extension)', async () => {
      await createTool(testDir, 'web-search.yaml', TOOL_YAML);

      const provider = new FileToolProvider({ root: testDir });
      const tools = await provider.list();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('web-search');
      expect(tools[0].description).toBe('Search the web for information');
      expect(tools[0].labels).toEqual(['search', 'web', 'research']);
      expect(tools[0].source).toBe('file-tools');
    });

    it('parses tool YAML files (.yml extension)', async () => {
      await createTool(testDir, 'web-search.yml', TOOL_YAML);

      const provider = new FileToolProvider({ root: testDir });
      const tools = await provider.list();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('web-search');
    });

    it('skips non-yaml files', async () => {
      const toolsDir = join(testDir, '.ai', 'tools');
      await mkdir(toolsDir, { recursive: true });
      await writeFile(join(toolsDir, 'README.md'), '# Tools', 'utf-8');
      await writeFile(join(toolsDir, 'config.json'), '{}', 'utf-8');
      await createTool(testDir, 'valid.yaml', TOOL_YAML);

      const provider = new FileToolProvider({ root: testDir });
      const tools = await provider.list();
      expect(tools).toHaveLength(1);
    });

    it('uses filename as name when no name field in YAML', async () => {
      await createTool(testDir, 'unnamed-tool.yaml', TOOL_YAML_MINIMAL);

      const provider = new FileToolProvider({ root: testDir });
      const tools = await provider.list();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('unnamed-tool');
    });

    it('lists multiple tools', async () => {
      await createTool(testDir, 'web-search.yaml', TOOL_YAML);
      await createTool(testDir, 'code-runner.yaml', TOOL_YAML_B);

      const provider = new FileToolProvider({ root: testDir });
      const tools = await provider.list();
      expect(tools).toHaveLength(2);
    });

    it('caches results (second call does not re-read disk)', async () => {
      await createTool(testDir, 'web-search.yaml', TOOL_YAML);

      const provider = new FileToolProvider({ root: testDir });
      const first = await provider.list();
      // Add another tool after first list() call
      await createTool(testDir, 'code-runner.yaml', TOOL_YAML_B);
      const second = await provider.list();

      expect(first).toBe(second); // Same reference, cached
      expect(second).toHaveLength(1); // Only the original tool
    });

    it('includes empty config object', async () => {
      await createTool(testDir, 'web-search.yaml', TOOL_YAML);

      const provider = new FileToolProvider({ root: testDir });
      const tools = await provider.list();
      expect(tools[0].config).toEqual({});
    });
  });

  describe('match', () => {
    it('returns tools matching labels', async () => {
      await createTool(testDir, 'web-search.yaml', TOOL_YAML);
      await createTool(testDir, 'code-runner.yaml', TOOL_YAML_B);

      const provider = new FileToolProvider({ root: testDir });
      const matches = await provider.match([{ name: 'search', source: 'test' }]);
      expect(matches).toHaveLength(1);
      expect(matches[0].name).toBe('web-search');
    });

    it('returns empty when no labels match', async () => {
      await createTool(testDir, 'web-search.yaml', TOOL_YAML);

      const provider = new FileToolProvider({ root: testDir });
      const matches = await provider.match([{ name: 'architecture', source: 'test' }]);
      expect(matches).toEqual([]);
    });

    it('returns multiple matching tools', async () => {
      await createTool(testDir, 'web-search.yaml', TOOL_YAML);
      await createTool(testDir, 'code-runner.yaml', TOOL_YAML_B);

      const provider = new FileToolProvider({ root: testDir });
      // 'research' matches web-search, 'code' matches code-runner
      const matches = await provider.match([
        { name: 'research', source: 'test' },
        { name: 'code', source: 'test' },
      ]);
      expect(matches).toHaveLength(2);
    });

    it('matching is case-insensitive', async () => {
      await createTool(testDir, 'web-search.yaml', TOOL_YAML);

      const provider = new FileToolProvider({ root: testDir });
      const matches = await provider.match([{ name: 'SEARCH', source: 'test' }]);
      expect(matches).toHaveLength(1);
    });
  });

  describe('load', () => {
    it('returns tool by name', async () => {
      await createTool(testDir, 'web-search.yaml', TOOL_YAML);

      const provider = new FileToolProvider({ root: testDir });
      const tool = await provider.load('web-search');
      expect(tool).not.toBeNull();
      expect(tool?.name).toBe('web-search');
      expect(tool?.description).toBe('Search the web for information');
    });

    it('returns null for unknown tool', async () => {
      const provider = new FileToolProvider({ root: testDir });
      const tool = await provider.load('nonexistent-tool');
      expect(tool).toBeNull();
    });

    it('returns null when no tools dir exists', async () => {
      const provider = new FileToolProvider({ root: testDir });
      const tool = await provider.load('any-tool');
      expect(tool).toBeNull();
    });
  });
});
