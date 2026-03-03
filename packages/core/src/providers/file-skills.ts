import { readdir, readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillProvider } from '../contracts.js';
import type { Skill, Label } from '../types.js';

export class FileSkillProvider implements SkillProvider {
  private skillsDirs: string[];
  private cache: Skill[] | null = null;

  constructor(options: Record<string, unknown> = {}) {
    const root = (options.root as string) ?? process.cwd();
    this.skillsDirs = [join(root, '.ai', 'skills')];

    // Also scan project-level skills (projects/*/.ai/skills/)
    const projectsDir = join(root, 'projects');
    try {
      const projects = readdirSync(projectsDir, { withFileTypes: true });
      for (const p of projects) {
        if (p.isDirectory()) {
          this.skillsDirs.push(join(projectsDir, p.name, '.ai', 'skills'));
        }
      }
    } catch {
      // No projects directory
    }
  }

  async list(): Promise<Skill[]> {
    if (this.cache) return this.cache;

    const skills: Skill[] = [];

    for (const skillsDir of this.skillsDirs) {
      let dirs: string[];
      try {
        dirs = await readdir(skillsDir);
      } catch {
        continue;
      }

      for (const dir of dirs) {
        const skillPath = join(skillsDir, dir, 'SKILL.md');
        try {
          const content = await readFile(skillPath, 'utf-8');
          const skill = parseSkillFrontmatter(content, dir, skillPath);
          if (skill) skills.push(skill);
        } catch {
          // Skip invalid skills
        }
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

      // Match if any trigger keyword matches (excluding meta-triggers)
      const META = new Set(['always', 'auto', 'manual', 'boot', 'heartbeat', 'pipeline', 'audit']);
      const triggerKeywordMatch = skill.triggers?.some(
        t => !META.has(t) && labelNames.has(t.toLowerCase()),
      ) ?? false;

      // Match if trigger is "always"
      const alwaysMatch = skill.triggers?.includes('always') ?? false;

      return labelMatch || triggerKeywordMatch || alwaysMatch;
    });
  }

  async load(name: string): Promise<string | null> {
    for (const dir of this.skillsDirs) {
      const skillPath = join(dir, name, 'SKILL.md');
      try {
        return await readFile(skillPath, 'utf-8');
      } catch {
        continue;
      }
    }
    return null;
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
