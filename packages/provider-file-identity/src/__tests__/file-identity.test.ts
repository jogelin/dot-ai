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
  });
});
