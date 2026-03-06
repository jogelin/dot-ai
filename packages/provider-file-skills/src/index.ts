/**
 * @dot-ai/ext-file-skills — File-based skills extension.
 * Discovers skills from .ai/skills/{name}/SKILL.md
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExtensionAPI } from '@dot-ai/core';
import { discoverNodes, parseScanDirs } from '@dot-ai/core';

interface Skill {
  name: string;
  description: string;
  labels: string[];
  triggers?: string[];
  content?: string;
  path: string;
  node?: string;
  enabled?: boolean;
}

export default function extFileSkills(api: ExtensionAPI): void {
  const nodes = discoverNodes(api.workspaceRoot, parseScanDirs('projects'));
  const skillsDirs = nodes.map(n => ({ dir: join(n.path, 'skills'), node: n.name }));
  let cache: Skill[] | null = null;

  async function listSkills(): Promise<Skill[]> {
    if (cache) return cache;
    const skills: Skill[] = [];
    for (const { dir, node } of skillsDirs) {
      let dirs: string[];
      try { dirs = await readdir(dir); } catch { continue; }
      for (const name of dirs) {
        const skillPath = join(dir, name, 'SKILL.md');
        try {
          const content = await readFile(skillPath, 'utf-8');
          const skill = parseSkillFrontmatter(content, name, skillPath);
          if (skill) { skill.node = node; skills.push(skill); }
        } catch { /* skip */ }
      }
    }
    cache = skills.filter(s => s.enabled !== false);
    return cache;
  }

  const META = new Set(['always', 'auto', 'manual', 'boot', 'heartbeat', 'pipeline', 'audit']);

  function matchSkills(skills: Skill[], labelNames: Set<string>): Skill[] {
    return skills.filter(skill => {
      const labelMatch = skill.labels.some(sl => labelNames.has(sl.toLowerCase()));
      const triggerMatch = skill.triggers?.some(t => !META.has(t) && labelNames.has(t.toLowerCase())) ?? false;
      const alwaysMatch = skill.triggers?.includes('always') ?? false;
      return labelMatch || triggerMatch || alwaysMatch;
    });
  }

  api.on('resources_discover', async () => {
    const skills = await listSkills();
    const labels = new Set<string>();
    for (const s of skills) {
      for (const l of s.labels) labels.add(l);
      for (const t of s.triggers ?? []) labels.add(t);
    }
    return { labels: Array.from(labels) };
  });

  api.on('context_enrich', async (event) => {
    const skills = await listSkills();
    const labelNames = new Set(event.labels.map((l: { name: string }) => l.name.toLowerCase()));
    const matched = matchSkills(skills, labelNames);
    if (matched.length === 0) return;
    const sections = [];
    for (const skill of matched.slice(0, 5)) {
      let content = skill.content;
      if (!content) {
        try { content = await readFile(skill.path, 'utf-8'); } catch { continue; }
      }
      sections.push({
        id: `skill:${skill.name}`,
        title: `Skill: ${skill.name}`,
        content: content ?? skill.description,
        priority: 60,
        source: 'ext-file-skills',
        trimStrategy: 'drop' as const,
      });
    }
    return { sections };
  });
}

function parseSkillFrontmatter(content: string, name: string, path: string): Skill | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name, description: '', labels: [], path, content };
  const fm = match[1];
  const description = extractValue(fm, 'description') ?? '';
  const labels = extractArray(fm, 'labels');
  const triggers = extractArray(fm, 'triggers');
  const enabledStr = extractValue(fm, 'enabled');
  const enabled = enabledStr === 'false' ? false : undefined;
  return { name, description, labels, triggers, enabled, path };
}

function extractValue(yaml: string, key: string): string | undefined {
  const m = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
}

function extractArray(yaml: string, key: string): string[] {
  const m = yaml.match(new RegExp(`^${key}:\\s*\\[(.*)\\]$`, 'm'));
  if (!m) return [];
  return m[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}
