/**
 * WorkspaceBuilder — fluent API for creating realistic .ai/ workspace fixtures.
 *
 * Creates a real temp directory on disk so the dot-ai runtime can boot
 * and load extensions exactly as it would in production.
 *
 * Usage:
 *   const ws = await WorkspaceBuilder.create()
 *     .withSkill('deploy', { description: '...', labels: ['deploy'], content: '...' })
 *     .withMemory('Fixed auth bug')
 *     .withIdentity('AGENTS.md', '# AGENTS\nYou are a helpful assistant.')
 *     .build();
 *
 *   // ... run scenarios
 *   await ws.cleanup();
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SkillDefinition {
  /** One-line description used for matching and catalog display */
  description: string;
  /** Labels used for vocabulary-based matching */
  labels?: string[];
  /** Trigger words (e.g. 'always', 'deploy to prod') */
  triggers?: string[];
  /** Full markdown content of the SKILL.md (after frontmatter) */
  content: string;
}

export interface MemoryEntry {
  content: string;
  type?: 'fact' | 'decision' | 'log' | 'pattern' | 'lesson';
  date?: string;
}

export interface BuiltWorkspace {
  /** Absolute path to the temp workspace root */
  dir: string;
  /** Call in afterEach/afterAll to delete the temp directory */
  cleanup(): Promise<void>;
}

// ── Builder ───────────────────────────────────────────────────────────────────

export class WorkspaceBuilder {
  private readonly skills = new Map<string, SkillDefinition>();
  private readonly memories: MemoryEntry[] = [];
  private readonly identities = new Map<string, string>(); // filename → content
  private settings: Record<string, unknown> | null = null;

  /**
   * Create a new builder synchronously.
   * The temp directory is created lazily in build().
   * This allows full fluent chaining: WorkspaceBuilder.create().withSkill(...).build()
   */
  static create(): WorkspaceBuilder {
    return new WorkspaceBuilder();
  }

  /**
   * Add a skill to .ai/skills/{name}/SKILL.md
   * The frontmatter is generated from the definition.
   */
  withSkill(name: string, def: SkillDefinition): this {
    this.skills.set(name, def);
    return this;
  }

  /**
   * Add a memory entry. Entries are written to .ai/memory/{today}.md
   * Pass a string for a quick one-liner (type defaults to 'fact').
   */
  withMemory(entry: string | MemoryEntry): this {
    if (typeof entry === 'string') {
      this.memories.push({ content: entry, type: 'fact' });
    } else {
      this.memories.push(entry);
    }
    return this;
  }

  /**
   * Add an identity file to .ai/{filename}
   * Common filenames: 'AGENTS.md', 'SOUL.md', 'USER.md', 'IDENTITY.md'
   */
  withIdentity(filename: string, content: string): this {
    this.identities.set(filename, content);
    return this;
  }

  /**
   * Write a .ai/settings.json for the workspace.
   * Useful for hook-based tests (e.g. Claude hook) that boot the runtime
   * independently and need to know which extensions to load.
   *
   * Example: configure extension paths so the Claude hook loads real extensions:
   *   .withSettings({ extensions: { paths: ['/path/to/ext-file-skills/dist/index.js'] } })
   */
  withSettings(settings: Record<string, unknown>): this {
    this.settings = settings;
    return this;
  }

  /** Create the temp directory, write all configured files, return the workspace handle */
  async build(): Promise<BuiltWorkspace> {
    const dir = await mkdtemp(join(tmpdir(), 'dot-ai-e2e-'));
    await mkdir(join(dir, '.ai'), { recursive: true });

    // Write skills: .ai/skills/{name}/SKILL.md
    for (const [name, def] of this.skills) {
      const skillDir = join(dir, '.ai', 'skills', name);
      await mkdir(skillDir, { recursive: true });
      const frontmatter = buildFrontmatter(name, def);
      await writeFile(join(skillDir, 'SKILL.md'), frontmatter + def.content, 'utf-8');
    }

    // Write memories: .ai/memory/{date}.md
    if (this.memories.length > 0) {
      const memDir = join(dir, '.ai', 'memory');
      await mkdir(memDir, { recursive: true });
      const date = new Date().toISOString().slice(0, 10);
      const lines = this.memories.map(m => `- ${m.content}`).join('\n');
      await writeFile(join(memDir, `${date}.md`), lines + '\n', 'utf-8');
    }

    // Write identities: .ai/{filename}
    for (const [filename, content] of this.identities) {
      await writeFile(join(dir, '.ai', filename), content, 'utf-8');
    }

    // Write settings.json if configured
    if (this.settings) {
      await writeFile(join(dir, '.ai', 'settings.json'), JSON.stringify(this.settings, null, 2), 'utf-8');
    }

    return {
      dir,
      cleanup: () => rm(dir, { recursive: true, force: true }),
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFrontmatter(name: string, def: SkillDefinition): string {
  const labels = (def.labels ?? []).map(l => `"${l}"`).join(', ');
  const triggers = (def.triggers ?? []).map(t => `"${t}"`).join(', ');
  return [
    '---',
    `name: ${name}`,
    `description: "${def.description}"`,
    `labels: [${labels}]`,
    `triggers: [${triggers}]`,
    '---',
    '',
  ].join('\n');
}
