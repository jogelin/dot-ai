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

export default async function extFileSkills(api: ExtensionAPI): Promise<void> {
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
    const scored = skills
      .map(skill => {
        // Skills with trigger 'manual' are only injected on explicit request
        const isManual = skill.triggers?.includes('manual') ?? false;
        if (isManual) return { skill, score: 0 };

        // 'always' trigger → automatic match
        const alwaysMatch = skill.triggers?.includes('always') ?? false;
        if (alwaysMatch) return { skill, score: 10 };

        // Custom trigger match (non-meta triggers found in labels) → strong signal
        const triggerMatches = (skill.triggers ?? [])
          .filter(t => !META.has(t) && labelNames.has(t.toLowerCase())).length;
        if (triggerMatches > 0) return { skill, score: 5 + triggerMatches };

        // Label matching: count how many skill labels match
        const labelMatches = skill.labels.filter(sl => labelNames.has(sl.toLowerCase())).length;
        const totalLabels = skill.labels.length;

        // Require at least 2 label matches, OR 1 match if the skill has only 1 label
        if (labelMatches === 0) return { skill, score: 0 };
        if (totalLabels === 1 && labelMatches === 1) return { skill, score: 2 };
        if (labelMatches < 2) return { skill, score: 0 };

        return { skill, score: labelMatches };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.map(({ skill }) => skill);
  }

  // Eagerly discover and register all skills at boot
  const bootSkills = await listSkills();
  for (const skill of bootSkills) {
    api.registerSkill(skill);
  }

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
