import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileIdentityProvider } from '../index.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'dot-ai-test-'));
});

describe('FileIdentityProvider', () => {
  describe('load', () => {
    it('returns empty when no .ai dir exists', async () => {
      const provider = new FileIdentityProvider({ root: testDir });
      const identities = await provider.load();
      expect(identities).toEqual([]);
    });

    it('returns empty when .ai dir has none of the identity files', async () => {
      await mkdir(join(testDir, '.ai'), { recursive: true });
      const provider = new FileIdentityProvider({ root: testDir });
      const identities = await provider.load();
      expect(identities).toEqual([]);
    });

    it('loads AGENTS.md with type "agents" and priority 100', async () => {
      const aiDir = join(testDir, '.ai');
      await mkdir(aiDir, { recursive: true });
      await writeFile(join(aiDir, 'AGENTS.md'), '# Agents\nYou are an assistant.', 'utf-8');

      const provider = new FileIdentityProvider({ root: testDir });
      const identities = await provider.load();
      expect(identities).toHaveLength(1);
      expect(identities[0].type).toBe('agents');
      expect(identities[0].priority).toBe(100);
      expect(identities[0].content).toBe('# Agents\nYou are an assistant.');
      expect(identities[0].source).toBe('file-identity');
    });

    it('loads SOUL.md with type "soul" and priority 90', async () => {
      const aiDir = join(testDir, '.ai');
      await mkdir(aiDir, { recursive: true });
      await writeFile(join(aiDir, 'SOUL.md'), '# Soul\nBe helpful.', 'utf-8');

      const provider = new FileIdentityProvider({ root: testDir });
      const identities = await provider.load();
      expect(identities).toHaveLength(1);
      expect(identities[0].type).toBe('soul');
      expect(identities[0].priority).toBe(90);
    });

    it('loads USER.md with type "user" and priority 80', async () => {
      const aiDir = join(testDir, '.ai');
      await mkdir(aiDir, { recursive: true });
      await writeFile(join(aiDir, 'USER.md'), '# User\nName: Jo', 'utf-8');

      const provider = new FileIdentityProvider({ root: testDir });
      const identities = await provider.load();
      expect(identities).toHaveLength(1);
      expect(identities[0].type).toBe('user');
      expect(identities[0].priority).toBe(80);
    });

    it('loads IDENTITY.md with type "identity" and priority 70', async () => {
      const aiDir = join(testDir, '.ai');
      await mkdir(aiDir, { recursive: true });
      await writeFile(join(aiDir, 'IDENTITY.md'), '# Identity\nName: Kiwi', 'utf-8');

      const provider = new FileIdentityProvider({ root: testDir });
      const identities = await provider.load();
      expect(identities).toHaveLength(1);
      expect(identities[0].type).toBe('identity');
      expect(identities[0].priority).toBe(70);
    });

    it('returns identities sorted by priority (highest first)', async () => {
      const aiDir = join(testDir, '.ai');
      await mkdir(aiDir, { recursive: true });
      await writeFile(join(aiDir, 'AGENTS.md'), '# Agents', 'utf-8');
      await writeFile(join(aiDir, 'SOUL.md'), '# Soul', 'utf-8');
      await writeFile(join(aiDir, 'USER.md'), '# User', 'utf-8');
      await writeFile(join(aiDir, 'IDENTITY.md'), '# Identity', 'utf-8');

      const provider = new FileIdentityProvider({ root: testDir });
      const identities = await provider.load();
      expect(identities).toHaveLength(4);
      // Provider processes in fixed order: agents(100), soul(90), user(80), identity(70)
      expect(identities[0].type).toBe('agents');
      expect(identities[1].type).toBe('soul');
      expect(identities[2].type).toBe('user');
      expect(identities[3].type).toBe('identity');
    });

    it('skips missing identity files', async () => {
      const aiDir = join(testDir, '.ai');
      await mkdir(aiDir, { recursive: true });
      // Only create AGENTS.md and IDENTITY.md, skip SOUL.md and USER.md
      await writeFile(join(aiDir, 'AGENTS.md'), '# Agents', 'utf-8');
      await writeFile(join(aiDir, 'IDENTITY.md'), '# Identity', 'utf-8');

      const provider = new FileIdentityProvider({ root: testDir });
      const identities = await provider.load();
      expect(identities).toHaveLength(2);
      const types = identities.map(i => i.type);
      expect(types).toContain('agents');
      expect(types).toContain('identity');
      expect(types).not.toContain('soul');
      expect(types).not.toContain('user');
    });

    it('reads actual content from all 4 identity files', async () => {
      const aiDir = join(testDir, '.ai');
      await mkdir(aiDir, { recursive: true });
      await writeFile(join(aiDir, 'AGENTS.md'), 'agents content', 'utf-8');
      await writeFile(join(aiDir, 'SOUL.md'), 'soul content', 'utf-8');
      await writeFile(join(aiDir, 'USER.md'), 'user content', 'utf-8');
      await writeFile(join(aiDir, 'IDENTITY.md'), 'identity content', 'utf-8');

      const provider = new FileIdentityProvider({ root: testDir });
      const identities = await provider.load();
      const byType = Object.fromEntries(identities.map(i => [i.type, i.content]));
      expect(byType['agents']).toBe('agents content');
      expect(byType['soul']).toBe('soul content');
      expect(byType['user']).toBe('user content');
      expect(byType['identity']).toBe('identity content');
    });

    it('does NOT load project AGENT.md files from non-root nodes', async () => {
      // Root node
      const rootAiDir = join(testDir, '.ai');
      await mkdir(rootAiDir, { recursive: true });
      await writeFile(join(rootAiDir, 'AGENTS.md'), 'root agents', 'utf-8');

      // Project node
      const projDir = join(testDir, 'projects', 'myapp', '.ai');
      await mkdir(projDir, { recursive: true });
      await writeFile(join(projDir, 'AGENT.md'), 'myapp agent content', 'utf-8');

      const provider = new FileIdentityProvider({
        nodes: [
          { name: 'root', path: rootAiDir, root: true },
          { name: 'myapp', path: projDir, root: false },
        ],
      });

      const identities = await provider.load();
      // Should only have root identities
      expect(identities).toHaveLength(1);
      expect(identities[0].type).toBe('agents');
      expect(identities[0].content).toBe('root agents');
      // Project identity should NOT be loaded
      const types = identities.map(i => i.type);
      expect(types).not.toContain('agent');
    });
  });

  describe('match', () => {
    it('returns empty array when no project nodes exist', async () => {
      const aiDir = join(testDir, '.ai');
      await mkdir(aiDir, { recursive: true });

      const provider = new FileIdentityProvider({ root: testDir });
      const result = await provider.match!([{ name: 'anything', source: 'test' }]);
      expect(result).toEqual([]);
    });

    it('returns empty array when no labels match project node names', async () => {
      const rootAiDir = join(testDir, '.ai');
      await mkdir(rootAiDir, { recursive: true });

      const projDir = join(testDir, 'projects', 'myapp', '.ai');
      await mkdir(projDir, { recursive: true });
      await writeFile(join(projDir, 'AGENT.md'), 'myapp agent content', 'utf-8');

      const provider = new FileIdentityProvider({
        nodes: [
          { name: 'root', path: rootAiDir, root: true },
          { name: 'myapp', path: projDir, root: false },
        ],
      });

      // Label 'other' does not match 'myapp'
      const result = await provider.match!([{ name: 'other', source: 'test' }]);
      expect(result).toEqual([]);
    });

    it('returns project identity when label matches node name', async () => {
      const rootAiDir = join(testDir, '.ai');
      await mkdir(rootAiDir, { recursive: true });

      const projDir = join(testDir, 'projects', 'myapp', '.ai');
      await mkdir(projDir, { recursive: true });
      await writeFile(join(projDir, 'AGENT.md'), 'myapp agent content', 'utf-8');

      const provider = new FileIdentityProvider({
        nodes: [
          { name: 'root', path: rootAiDir, root: true },
          { name: 'myapp', path: projDir, root: false },
        ],
      });

      const result = await provider.match!([{ name: 'myapp', source: 'labels' }]);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('agent');
      expect(result[0].content).toBe('myapp agent content');
      expect(result[0].node).toBe('myapp');
      expect(result[0].priority).toBe(50);
      expect(result[0].source).toBe('file-identity');
    });

    it('returns only matching project identities when multiple nodes exist', async () => {
      const rootAiDir = join(testDir, '.ai');
      await mkdir(rootAiDir, { recursive: true });

      const proj1Dir = join(testDir, 'projects', 'proj1', '.ai');
      await mkdir(proj1Dir, { recursive: true });
      await writeFile(join(proj1Dir, 'AGENT.md'), 'proj1 content', 'utf-8');

      const proj2Dir = join(testDir, 'projects', 'proj2', '.ai');
      await mkdir(proj2Dir, { recursive: true });
      await writeFile(join(proj2Dir, 'AGENT.md'), 'proj2 content', 'utf-8');

      const provider = new FileIdentityProvider({
        nodes: [
          { name: 'root', path: rootAiDir, root: true },
          { name: 'proj1', path: proj1Dir, root: false },
          { name: 'proj2', path: proj2Dir, root: false },
        ],
      });

      // Only label 'proj1' matches
      const result = await provider.match!([{ name: 'proj1', source: 'labels' }]);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('proj1 content');
      expect(result[0].node).toBe('proj1');
    });

    it('returns multiple project identities when multiple labels match', async () => {
      const rootAiDir = join(testDir, '.ai');
      await mkdir(rootAiDir, { recursive: true });

      const proj1Dir = join(testDir, 'projects', 'proj1', '.ai');
      await mkdir(proj1Dir, { recursive: true });
      await writeFile(join(proj1Dir, 'AGENT.md'), 'proj1 content', 'utf-8');

      const proj2Dir = join(testDir, 'projects', 'proj2', '.ai');
      await mkdir(proj2Dir, { recursive: true });
      await writeFile(join(proj2Dir, 'AGENT.md'), 'proj2 content', 'utf-8');

      const provider = new FileIdentityProvider({
        nodes: [
          { name: 'root', path: rootAiDir, root: true },
          { name: 'proj1', path: proj1Dir, root: false },
          { name: 'proj2', path: proj2Dir, root: false },
        ],
      });

      const result = await provider.match!([
        { name: 'proj1', source: 'labels' },
        { name: 'proj2', source: 'labels' },
      ]);
      expect(result).toHaveLength(2);
      const nodes = result.map(r => r.node);
      expect(nodes).toContain('proj1');
      expect(nodes).toContain('proj2');
    });

    it('skips project nodes whose AGENT.md file is missing', async () => {
      const rootAiDir = join(testDir, '.ai');
      await mkdir(rootAiDir, { recursive: true });

      // proj1 has no AGENT.md
      const proj1Dir = join(testDir, 'projects', 'proj1', '.ai');
      await mkdir(proj1Dir, { recursive: true });
      // No AGENT.md written

      const provider = new FileIdentityProvider({
        nodes: [
          { name: 'root', path: rootAiDir, root: true },
          { name: 'proj1', path: proj1Dir, root: false },
        ],
      });

      const result = await provider.match!([{ name: 'proj1', source: 'labels' }]);
      expect(result).toEqual([]);
    });
  });
});
