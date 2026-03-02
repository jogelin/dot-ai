import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SkillProvider } from '../contracts.js';
import type { Skill, Label } from '../types.js';

export class FileSkillProvider implements SkillProvider {
  private skillsDir: string;
  private cache: Skill[] | null = null;

  constructor(options: Record<string, unknown> = {}) {
    const root = (options.root as string) ?? process.cwd();
    this.skillsDir = join(root, '.ai', 'skills');
  }

  async list(): Promise<Skill[]> {
    if (this.cache) return this.cache;

    const skills: Skill[] = [];
    let dirs: string[];
    try {
      dirs = await readdir(this.skillsDir);
    } catch {
      return [];
    }

    for (const dir of dirs) {
      const skillPath = join(this.skillsDir, dir, 'SKILL.md');
      try {
        const content = await readFile(skillPath, 'utf-8');
        const skill = parseSkillFrontmatter(content, dir, skillPath);
        if (skill) skills.push(skill);
      } catch {
        // Skip invalid skills
      }
    }

    this.cache = skills;
    return skills;
  }

  async match(labels: Label[]): Promise<Skill[]> {
    const all = await this.list();
    const labelNames = new Set(labels.map(l => l.name.toLowerCase()));

    return all.filter(skill => {
      // Match if any skill label matches any prompt label
      const labelMatch = skill.labels.some(sl => labelNames.has(sl.toLowerCase()));

      // Match if any trigger pattern matches
      const triggerMatch = skill.triggers?.includes('always') ?? false;

      return labelMatch || triggerMatch;
    });
  }

  async load(name: string): Promise<string | null> {
    const skillPath = join(this.skillsDir, name, 'SKILL.md');
    try {
      return await readFile(skillPath, 'utf-8');
    } catch {
      return null;
    }
  }
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Expects format:
 * ---
 * description: ...
 * labels: [a, b, c]
 * triggers: [always]
 * ---
 * Content here...
 */
function parseSkillFrontmatter(content: string, name: string, path: string): Skill | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return { name, description: '', labels: [], path, content };
  }

  const frontmatter = match[1];
  const description = extractValue(frontmatter, 'description') ?? '';
  const labels = extractArray(frontmatter, 'labels');
  const triggers = extractArray(frontmatter, 'triggers');
  const dependsOn = extractArray(frontmatter, 'dependsOn');
  const requiresTools = extractArray(frontmatter, 'requiresTools');

  return { name, description, labels, triggers, dependsOn, requiresTools, path };
}

function extractValue(yaml: string, key: string): string | undefined {
  const match = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : undefined;
}

function extractArray(yaml: string, key: string): string[] {
  const match = yaml.match(new RegExp(`^${key}:\\s*\\[(.*)\\]$`, 'm'));
  if (!match) return [];
  return match[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}
