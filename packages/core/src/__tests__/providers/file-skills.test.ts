import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSkillProvider } from '../../providers/file-skills.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'dot-ai-test-'));
});

const SKILL_WITH_FRONTMATTER = `---
description: Manage tasks in Cockpit
labels: [tasks, cockpit, todo]
triggers: [tasks]
---

# dot-ai-tasks Skill

Use this skill to manage tasks.
`;

const SKILL_ALWAYS_TRIGGER = `---
description: Always active skill
labels: [system]
triggers: [always]
---

# Always Skill
`;

const SKILL_NO_FRONTMATTER = `# Simple Skill

No frontmatter here.
`;

async function createSkill(dir: string, name: string, content: string): Promise<void> {
  const skillDir = join(dir, '.ai', 'skills', name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), content, 'utf-8');
}

describe('FileSkillProvider', () => {
  describe('list', () => {
    it('returns empty when no skills dir', async () => {
      const provider = new FileSkillProvider({ root: testDir });
      const skills = await provider.list();
      expect(skills).toEqual([]);
    });

    it('returns empty when skills dir is empty', async () => {
      await mkdir(join(testDir, '.ai', 'skills'), { recursive: true });
      const provider = new FileSkillProvider({ root: testDir });
      const skills = await provider.list();
      expect(skills).toEqual([]);
    });

    it('parses SKILL.md frontmatter correctly', async () => {
      await createSkill(testDir, 'dot-ai-tasks', SKILL_WITH_FRONTMATTER);

      const provider = new FileSkillProvider({ root: testDir });
      const skills = await provider.list();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('dot-ai-tasks');
      expect(skills[0].description).toBe('Manage tasks in Cockpit');
      expect(skills[0].labels).toEqual(['tasks', 'cockpit', 'todo']);
      expect(skills[0].triggers).toEqual(['tasks']);
    });

    it('parses skill without frontmatter', async () => {
      await createSkill(testDir, 'simple-skill', SKILL_NO_FRONTMATTER);

      const provider = new FileSkillProvider({ root: testDir });
      const skills = await provider.list();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('simple-skill');
      expect(skills[0].description).toBe('');
      expect(skills[0].labels).toEqual([]);
    });

    it('skips dirs without SKILL.md', async () => {
      const skillsDir = join(testDir, '.ai', 'skills');
      await mkdir(join(skillsDir, 'empty-dir'), { recursive: true });
      await createSkill(testDir, 'valid-skill', SKILL_WITH_FRONTMATTER);

      const provider = new FileSkillProvider({ root: testDir });
      const skills = await provider.list();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('valid-skill');
    });

    it('lists multiple skills', async () => {
      await createSkill(testDir, 'skill-a', SKILL_WITH_FRONTMATTER);
      await createSkill(testDir, 'skill-b', SKILL_ALWAYS_TRIGGER);

      const provider = new FileSkillProvider({ root: testDir });
      const skills = await provider.list();
      expect(skills).toHaveLength(2);
    });

    it('caches results (second call does not re-read disk)', async () => {
      await createSkill(testDir, 'dot-ai-tasks', SKILL_WITH_FRONTMATTER);

      const provider = new FileSkillProvider({ root: testDir });
      const first = await provider.list();
      // Add a new skill after first list() call
      await createSkill(testDir, 'new-skill', SKILL_ALWAYS_TRIGGER);
      const second = await provider.list();

      expect(first).toBe(second); // Same reference, cached
      expect(second).toHaveLength(1); // Only the original skill
    });
  });

  describe('match', () => {
    it('returns skills matching labels', async () => {
      await createSkill(testDir, 'dot-ai-tasks', SKILL_WITH_FRONTMATTER);
      // Only add a skill that has no labels and no always trigger to keep count clean
      const skillNoMatch = `---\ndescription: Unrelated skill\nlabels: [routing, planning]\n---\n`;
      await createSkill(testDir, 'routing-skill', skillNoMatch);

      const provider = new FileSkillProvider({ root: testDir });
      const matches = await provider.match([{ name: 'tasks', source: 'test' }]);
      expect(matches).toHaveLength(1);
      expect(matches[0].name).toBe('dot-ai-tasks');
    });

    it('returns skills with trigger "always"', async () => {
      await createSkill(testDir, 'dot-ai-tasks', SKILL_WITH_FRONTMATTER);
      await createSkill(testDir, 'always-skill', SKILL_ALWAYS_TRIGGER);

      const provider = new FileSkillProvider({ root: testDir });
      // Use a label that matches nothing except "always" trigger
      const matches = await provider.match([{ name: 'unrelated', source: 'test' }]);
      expect(matches).toHaveLength(1);
      expect(matches[0].name).toBe('always-skill');
    });

    it('returns empty when no labels match', async () => {
      await createSkill(testDir, 'dot-ai-tasks', SKILL_WITH_FRONTMATTER);

      const provider = new FileSkillProvider({ root: testDir });
      const matches = await provider.match([{ name: 'architecture', source: 'test' }]);
      expect(matches).toEqual([]);
    });

    it('matches are case-insensitive', async () => {
      await createSkill(testDir, 'dot-ai-tasks', SKILL_WITH_FRONTMATTER);

      const provider = new FileSkillProvider({ root: testDir });
      const matches = await provider.match([{ name: 'TASKS', source: 'test' }]);
      expect(matches).toHaveLength(1);
    });
  });

  describe('enable/disable', () => {
    it('excludes skills with enabled: false in frontmatter', async () => {
      const disabledSkill = `---
description: Disabled skill
labels: [disabled]
enabled: false
---

# Disabled Skill
`;
      await createSkill(testDir, 'active-skill', SKILL_WITH_FRONTMATTER);
      await createSkill(testDir, 'disabled-skill', disabledSkill);

      const provider = new FileSkillProvider({ root: testDir });
      const skills = await provider.list();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('active-skill');
    });

    it('excludes skills listed in disabled config option', async () => {
      await createSkill(testDir, 'skill-a', SKILL_WITH_FRONTMATTER);
      await createSkill(testDir, 'skill-b', SKILL_ALWAYS_TRIGGER);

      const provider = new FileSkillProvider({
        root: testDir,
        disabled: 'skill-b',
      });
      const skills = await provider.list();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('skill-a');
    });

    it('supports comma-separated disabled list', async () => {
      await createSkill(testDir, 'skill-a', SKILL_WITH_FRONTMATTER);
      await createSkill(testDir, 'skill-b', SKILL_ALWAYS_TRIGGER);
      await createSkill(testDir, 'skill-c', SKILL_NO_FRONTMATTER);

      const provider = new FileSkillProvider({
        root: testDir,
        disabled: 'skill-a, skill-c',
      });
      const skills = await provider.list();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('skill-b');
    });

    it('disabled skills are excluded from match()', async () => {
      await createSkill(testDir, 'dot-ai-tasks', SKILL_WITH_FRONTMATTER);
      const disabledSkill = `---
description: Also about tasks
labels: [tasks]
enabled: false
---
Content
`;
      await createSkill(testDir, 'disabled-tasks', disabledSkill);

      const provider = new FileSkillProvider({ root: testDir });
      const matches = await provider.match([{ name: 'tasks', source: 'test' }]);
      expect(matches).toHaveLength(1);
      expect(matches[0].name).toBe('dot-ai-tasks');
    });

    it('enabled: true is treated as enabled (default)', async () => {
      const enabledSkill = `---
description: Explicitly enabled
labels: [test]
enabled: true
---
Content
`;
      await createSkill(testDir, 'enabled-skill', enabledSkill);

      const provider = new FileSkillProvider({ root: testDir });
      const skills = await provider.list();
      expect(skills).toHaveLength(1);
    });
  });

  describe('load', () => {
    it('returns skill content by name', async () => {
      await createSkill(testDir, 'dot-ai-tasks', SKILL_WITH_FRONTMATTER);

      const provider = new FileSkillProvider({ root: testDir });
      const content = await provider.load('dot-ai-tasks');
      expect(content).toBe(SKILL_WITH_FRONTMATTER);
    });

    it('returns null for unknown skill', async () => {
      const provider = new FileSkillProvider({ root: testDir });
      const content = await provider.load('nonexistent-skill');
      expect(content).toBeNull();
    });
  });
});
