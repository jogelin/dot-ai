/**
 * @dot-ai/ext-file-skills — File-based skills extension.
 *
 * v2: Description-based matching.
 * Instead of curated label lists, skills are matched by scoring the prompt
 * against `name + description + labels + triggers` using normalized word overlap.
 *
 * No more manual/auto distinction — every skill is matchable.
 * 'always' trigger is the only special trigger (forces injection).
 * Cron/heartbeat/boot triggers are ignored for prompt matching.
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

/** Pre-computed matching data for a skill, built once at boot */
interface SkillIndex {
  skill: Skill;
  /** Single words from name + description + labels (normalized, deduplicated) */
  words: Set<string>;
  /** Original labels (lowercased) — curated identifiers that get a score boost */
  labelWords: Set<string>;
  /** Multi-word phrases from triggers (normalized) */
  phrases: string[];
  /** Always-inject flag */
  always: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Text normalization
// ═══════════════════════════════════════════════════════════════════════════

/** Common French stopwords to exclude from matching */
const STOPWORDS = new Set([
  // French
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'en', 'au', 'aux',
  'ce', 'se', 'ne', 'pas', 'que', 'qui', 'est', 'sont', 'avec', 'pour', 'par', 'sur',
  'dans', 'plus', 'mais', 'son', 'ses', 'mon', 'mes', 'ton', 'tes', 'nous', 'vous',
  'ils', 'elle', 'elles', 'été', 'être', 'avoir', 'fait', 'faire', 'dit', 'quand',
  'tout', 'tous', 'comme', 'dont', 'cette', 'aussi', 'entre', 'après', 'avant',
  // English
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one',
  'our', 'out', 'use', 'when', 'asked', 'will', 'how', 'been', 'has', 'have', 'had',
  'its', 'from', 'this', 'that', 'with', 'they', 'what', 'which', 'their', 'would',
  'there', 'about', 'could', 'into', 'than', 'them', 'then', 'these', 'some',
  // Too generic / noise
  'skill', 'skills', 'manual', 'auto', 'cron', 'boot', 'heartbeat', 'always',
  // Common verbs that cause false positives
  'check', 'create', 'list', 'find', 'get', 'set', 'run', 'start', 'stop', 'add',
  'update', 'delete', 'remove', 'show', 'read', 'write', 'open', 'close',
  'manage', 'build', 'test', 'fix', 'debug', 'help', 'new', 'old',
]);

/**
 * Remove diacritics (accents) from a string.
 * "référencement" → "referencement", "tâche" → "tache"
 */
function removeDiacritics(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Basic French/English stemming — removes common suffixes.
 * Not a full stemmer, but catches plurals and common verb forms.
 */
function stem(word: string): string {
  if (word.length <= 3) return word;
  // French plurals + verb forms
  if (word.endsWith('ements')) return word.slice(0, -6);
  if (word.endsWith('ement')) return word.slice(0, -5);
  if (word.endsWith('ment')) return word.slice(0, -4);
  if (word.endsWith('tion')) return word.slice(0, -4);
  if (word.endsWith('ions')) return word.slice(0, -4);
  if (word.endsWith('ique')) return word.slice(0, -4);
  if (word.endsWith('ies')) return word.slice(0, -3);
  if (word.endsWith('eur')) return word.slice(0, -3);
  if (word.endsWith('eux')) return word.slice(0, -3);
  if (word.endsWith('ant')) return word.slice(0, -3);
  if (word.endsWith('ing')) return word.slice(0, -3);
  if (word.endsWith('ise')) return word.slice(0, -3);
  if (word.endsWith('ize')) return word.slice(0, -3);
  if (word.endsWith('er')) return word.slice(0, -2);
  if (word.endsWith('es')) return word.slice(0, -2);
  if (word.endsWith('ed')) return word.slice(0, -2);
  if (word.endsWith('ly')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/**
 * Tokenize and normalize a text string into a set of matchable words.
 * Splits on non-alphanumeric, lowercases, removes diacritics, stems, filters stopwords.
 * Also generates 5-char prefixes for cross-language matching
 * (e.g., "accessibility" and "accessibilité" both generate prefix "acces").
 */
function tokenize(text: string): string[] {
  const raw = removeDiacritics(text.toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 2 && !STOPWORDS.has(w));

  const result: string[] = [];
  for (const w of raw) {
    const stemmed = stem(w);
    result.push(stemmed);
    // Add 5-char prefix for cross-language fuzzy matching
    if (w.length >= 6) {
      result.push(w.slice(0, 5));
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Skill indexing & matching
// ═══════════════════════════════════════════════════════════════════════════

const LIFECYCLE_TRIGGERS = new Set(['always', 'auto', 'manual', 'boot', 'heartbeat', 'cron', 'pipeline', 'audit']);

/**
 * Build a search index for a skill from its metadata.
 * Combines name + description + labels into tokenized words.
 * Labels are also included as-is (lowercased) to preserve short identifiers (e.g., "poi", "nx", "ci").
 * Triggers become phrases for exact multi-word matching.
 */
function indexSkill(skill: Skill): SkillIndex {
  const textParts = [skill.name, skill.description, ...skill.labels];
  const words = new Set(textParts.flatMap(tokenize));
  // Raw labels as curated identifiers (bypass stopwords, get score boost)
  const labelWords = new Set(skill.labels.map(l => l.toLowerCase()));
  for (const lw of labelWords) words.add(lw);

  // Custom triggers (non-lifecycle) become searchable phrases
  const phrases = (skill.triggers ?? [])
    .filter(t => !LIFECYCLE_TRIGGERS.has(t))
    .map(t => removeDiacritics(t.toLowerCase()));

  return {
    skill,
    words,
    labelWords,
    phrases,
    always: skill.triggers?.includes('always') ?? false,
  };
}

/**
 * Minimum score to be considered a match (below this → not injected at all).
 * Raised from 1.5 to 2.5 so single weak-signal matches (one label hit with no
 * name/word overlap) don't inject noisy overviews.
 */
const MIN_SCORE = 2.5;

/**
 * Score threshold for directive-level injection.
 *
 * ≥ DIRECTIVE_THRESHOLD → detailLevel 'directive': "→ Use skill: name — description"
 * MIN_SCORE–DIRECTIVE_THRESHOLD → detailLevel 'overview': "name: description"
 *
 * At the typical scoring weights:
 *   label hit  → +2 (per label)
 *   name part  → +3 (per matching name segment ≥5 chars)
 *   word overlap → overlap²/sqrt(skill_word_count) (superlinear)
 *
 * Typical ranges:
 *   2 labels (no name, little overlap) → ~4-6        → overview
 *   2 labels + name match              → ~7-10       → overview/directive boundary
 *   3+ labels + name match             → ~11+        → directive
 *   4 labels + name + strong overlap   → ~15+        → directive
 *
 * 'always' trigger skills bypass both thresholds and inject full content.
 */
const DIRECTIVE_THRESHOLD = 8.0;

/**
 * Score a skill against a prompt. Higher = more relevant.
 *
 * Scoring components:
 * 1. Phrase match: if a trigger phrase appears verbatim in the prompt → +5
 * 2. Name match: if the skill name (or hyphenated parts) appear in the prompt → +4
 * 3. Word overlap: stemmed words in common, weighted to favor focused skills
 *    Formula: overlap² / (skill_words * 0.3) — rewards multiple matches superlinearly
 */
function scoreSkill(index: SkillIndex, promptWords: Set<string>, promptNormalized: string): number {
  if (index.always) return 100;

  let score = 0;

  // 1. Phrase matching — custom triggers found verbatim in the prompt
  for (const phrase of index.phrases) {
    if (phrase.length >= 2 && promptNormalized.includes(phrase)) {
      score += 5;
    }
  }

  // 2. Name matching — skill name or its parts in prompt
  // Only match meaningful name parts (≥ 5 chars, not in stopwords)
  const nameParts = removeDiacritics(index.skill.name.toLowerCase()).split(/[-_]/);
  let nameMatches = 0;
  for (const part of nameParts) {
    if (part.length >= 5 && !STOPWORDS.has(part) && promptNormalized.includes(part)) {
      nameMatches++;
    }
  }
  if (nameMatches > 0) {
    // Multiple name parts matching is a strong signal (e.g., "react" + "practices")
    score += nameMatches * 3;
  }

  // 3. Label boost — curated labels matching the prompt are high-signal
  // Use word-boundary check to avoid substring false positives
  // (e.g., "ci" in "merci", "pro" in "programme")
  for (const lw of index.labelWords) {
    if (promptWords.has(lw)) {
      score += 2;
    } else if (lw.length >= 4) {
      // Only do substring match for labels ≥ 4 chars (safe from "ci", "pro" etc.)
      const regex = new RegExp(`\\b${lw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(promptNormalized)) {
        score += 2;
      }
    }
  }

  // 4. Word overlap — superlinear scoring rewards multiple word matches
  let overlap = 0;
  for (const word of index.words) {
    if (promptWords.has(word)) overlap++;
  }
  if (overlap > 0) {
    // overlap² gives superlinear boost for multiple matches
    // Divide by sqrt(skill word count) to normalize for description length
    score += (overlap * overlap) / Math.sqrt(index.words.size);
  }

  return score;
}

// ═══════════════════════════════════════════════════════════════════════════
// Extension entry point
// ═══════════════════════════════════════════════════════════════════════════

export default async function extFileSkills(api: ExtensionAPI): Promise<void> {
  const nodes = discoverNodes(api.workspaceRoot, parseScanDirs('projects'));
  const skillsDirs = nodes.map(n => ({ dir: join(n.path, 'skills'), node: n.name }));
  let cache: Skill[] | null = null;
  let indexCache: SkillIndex[] | null = null;

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

  async function getIndex(): Promise<SkillIndex[]> {
    if (indexCache) return indexCache;
    const skills = await listSkills();
    indexCache = skills.map(indexSkill);
    return indexCache;
  }

  // Eagerly discover and register all skills at boot
  const bootSkills = await listSkills();
  for (const skill of bootSkills) {
    api.registerSkill(skill);
  }
  // Pre-build the index at boot
  await getIndex();

  // Tell the core what we are — contributes to the dot-ai:system section
  api.contributeMetadata({
    category: 'skills',
    backend: 'File-based',
    tools: ['load_skill'],
    stats: { count: bootSkills.length },
  });

  // On-demand skill loader: agent can request full SKILL.md content for any registered skill
  api.registerTool({
    name: 'load_skill',
    description: 'Load the full content of a skill file. Use when you need the complete instructions for a skill that was mentioned in the system section. Skill names are listed under "Other skills:" in the dot-ai system section.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name exactly as shown in the system section (e.g. "deploy-production", "git-workflow").',
        },
      },
      required: ['name'],
    },
    async execute(input) {
      const name = input['name'];
      if (typeof name !== 'string') {
        return { content: 'Error: "name" must be a string.', isError: true };
      }
      const skills = await listSkills();
      const skill = skills.find(s => s.name === name);
      if (!skill) {
        const available = skills.map(s => s.name).join(', ');
        return {
          content: `Skill "${name}" not found. Available skills: ${available || '(none)'}`,
          isError: true,
        };
      }
      let content = skill.content;
      if (!content) {
        try {
          content = await readFile(skill.path, 'utf-8');
        } catch {
          return { content: `Error reading skill file for "${name}".`, isError: true };
        }
      }
      return { content: content ?? skill.description, details: { name, path: skill.path } };
    },
  });

  api.on('context_enrich', async (event) => {
    const index = await getIndex();
    const prompt = (event as { prompt?: string }).prompt ?? '';
    const promptNormalized = removeDiacritics(prompt.toLowerCase());
    const promptWords = new Set(tokenize(prompt));

    // Score all skills
    const scored = index
      .map(idx => ({ idx, score: scoreSkill(idx, promptWords, promptNormalized) }))
      .filter(({ score }) => score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return;

    const sections = [];
    for (const { idx, score } of scored.slice(0, 5)) {
      let content: string;
      let detailLevel: 'full' | 'directive' | 'overview';

      if (idx.always) {
        // 'always' trigger: this skill must always be present with its full content.
        // It represents critical context (persona, rules, architecture) that the agent
        // needs verbatim on every turn.
        let full = idx.skill.content;
        if (!full) {
          try { full = await readFile(idx.skill.path, 'utf-8'); } catch { continue; }
        }
        content = full ?? idx.skill.description;
        detailLevel = 'full';
      } else if (score >= DIRECTIVE_THRESHOLD) {
        // High confidence match — guide the agent to use the skill explicitly.
        // Full content is available via load_skill tool or native file sync.
        content = `→ Use skill: ${idx.skill.name} — ${idx.skill.description}`;
        detailLevel = 'directive';
      } else {
        // Low-medium confidence — surface name + description only.
        // The agent can decide if it's relevant; full content on demand.
        content = `${idx.skill.name}: ${idx.skill.description}`;
        detailLevel = 'overview';
      }

      sections.push({
        id: `skill:${idx.skill.name}`,
        title: `Skill: ${idx.skill.name}`,
        content,
        priority: 60,
        source: 'ext-file-skills',
        trimStrategy: 'drop' as const,
        detailLevel,
        matchScore: score,
      });
    }
    return { sections };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// YAML frontmatter parsing
// ═══════════════════════════════════════════════════════════════════════════

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

// Export for testing
export { tokenize, stem, removeDiacritics, scoreSkill, indexSkill, MIN_SCORE, DIRECTIVE_THRESHOLD };
export type { SkillIndex };
