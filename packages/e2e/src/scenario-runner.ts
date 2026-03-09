/**
 * ScenarioRunner — boots a real DotAiRuntime against a test workspace
 * and returns a rich result object for assertions.
 *
 * Extensions are loaded from their compiled dist/ files so tests always
 * run against the real pipeline (no mocking).
 *
 * NOTE: Requires a prior `pnpm build` when extension source changes.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DotAiRuntime, formatSections } from '@dot-ai/core';
import type { Section } from '@dot-ai/core';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Packages directory: packages/e2e/src/ → ../.. → packages/
const PACKAGES_DIR = resolve(__dirname, '..', '..');

/**
 * Resolved paths to compiled extension dist files.
 * Add new extensions here as they are created.
 */
const EXTENSION_DIST: Record<string, string> = {
  skills:   resolve(PACKAGES_DIR, 'ext-file-skills',   'dist', 'index.js'),
  memory:   resolve(PACKAGES_DIR, 'ext-file-memory',   'dist', 'extension.js'),
  identity: resolve(PACKAGES_DIR, 'ext-file-identity', 'dist', 'index.js'),
};

export type ExtensionName = keyof typeof EXTENSION_DIST;

export interface ScenarioOptions {
  /** Which extensions to load. Defaults to ['skills', 'memory']. Pass [] for bare runtime. */
  extensions?: ExtensionName[];
  /** Token budget for formatting. Defaults to unlimited. */
  tokenBudget?: number;
}

// ── Result ────────────────────────────────────────────────────────────────────

/**
 * Rich result object returned by runScenario.
 * Provides typed helpers so test assertions are readable and intent-revealing.
 */
export class ScenarioResult {
  constructor(
    public readonly sections: Section[],
    public readonly labels: Array<{ name: string; source: string }>,
    public readonly routing: unknown,
    /** Internal: workspace dir (for on-demand tool calls) */
    private readonly _workspaceDir?: string,
    /** Internal: resolved extension paths (for on-demand tool calls) */
    private readonly _extensionPaths?: string[],
  ) {}

  // ── Formatting ──

  /** Full formatted markdown (as injected into the agent prompt) */
  get formatted(): string {
    return formatSections(this.sections);
  }

  /** Formatted output with a token budget applied */
  formattedWithBudget(tokenBudget: number): string {
    return formatSections(this.sections, { tokenBudget });
  }

  // ── Section accessors ──

  get systemSection(): Section | undefined {
    return this.sections.find(s => s.id === 'dot-ai:system');
  }

  get skillSections(): Section[] {
    return this.sections.filter(s => s.id?.startsWith('skill:'));
  }

  get memorySections(): Section[] {
    return this.sections.filter(s => s.source === 'ext-file-memory');
  }

  get identitySections(): Section[] {
    return this.sections.filter(s => s.source === 'ext-file-identity');
  }

  getSection(id: string): Section | undefined {
    return this.sections.find(s => s.id === id);
  }

  getSectionsBySource(source: string): Section[] {
    return this.sections.filter(s => s.source === source);
  }

  // ── Presence checks ──

  hasSection(id: string): boolean {
    return this.sections.some(s => s.id === id);
  }

  hasSkillSection(name: string): boolean {
    return this.sections.some(s => s.id === `skill:${name}`);
  }

  // ── Detail level checks (for Phase 2 features) ──

  hasDirectiveForSkill(name: string): boolean {
    return this.sections.some(
      s => s.id === `skill:${name}` && (s as SectionWithLevel).detailLevel === 'directive',
    );
  }

  hasOverviewForSkill(name: string): boolean {
    return this.sections.some(
      s => s.id === `skill:${name}` && (s as SectionWithLevel).detailLevel === 'overview',
    );
  }

  getDetailLevel(skillName: string): string | undefined {
    const s = this.sections.find(s => s.id === `skill:${skillName}`);
    return s ? (s as SectionWithLevel).detailLevel : undefined;
  }

  // ── Architecture metadata checks (for Phase 1 features) ──

  hasArchitectureEntry(category: string): boolean {
    const content = this.systemSection?.content ?? '';
    return content.toLowerCase().includes(category.toLowerCase());
  }

  // ── Label checks ──

  hasLabel(name: string): boolean {
    return this.labels.some(l => l.name === name);
  }

  // ── Tool execution ──

  /**
   * Execute a registered tool by name.
   * Boots a fresh runtime internally — no cleanup needed from the caller.
   *
   * Use to test that tools work correctly after the prompt pipeline has run.
   */
  async executeTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ content: string; details?: unknown; isError?: boolean }> {
    if (!this._workspaceDir || !this._extensionPaths) {
      throw new Error('executeTool: ScenarioResult was not created with workspace info');
    }
    const runtime = new DotAiRuntime({
      workspaceRoot: this._workspaceDir,
      extensions: { paths: this._extensionPaths },
    });
    await runtime.boot();
    try {
      return await runtime.executeTool(name, input);
    } finally {
      await runtime.shutdown();
    }
  }

  // ── Debug helpers ──

  /** List all section ids (useful in assertion failure messages) */
  get sectionIds(): string[] {
    return this.sections.map(s => s.id ?? `(anon:${s.source})`);
  }

  /** Summarize result for debugging */
  summary(): string {
    return [
      `Sections (${this.sections.length}): ${this.sectionIds.join(', ')}`,
      `Labels: ${this.labels.map(l => l.name).join(', ') || '(none)'}`,
      `Routing: ${JSON.stringify(this.routing)}`,
    ].join('\n');
  }
}

// Internal type for future detailLevel field on Section
interface SectionWithLevel extends Section {
  detailLevel?: 'directive' | 'overview' | 'full';
}

// ── Runner ────────────────────────────────────────────────────────────────────

/**
 * Boot a real DotAiRuntime against workspaceDir, process prompt, return result.
 *
 * @param workspaceDir - Absolute path to a workspace created by WorkspaceBuilder
 * @param prompt       - The user prompt to process
 * @param options      - Which extensions to load and optional token budget
 */
export async function runScenario(
  workspaceDir: string,
  prompt: string,
  options: ScenarioOptions = {},
): Promise<ScenarioResult> {
  const extensionNames = options.extensions ?? ['skills', 'memory'];
  const paths = extensionNames.map(name => {
    const p = EXTENSION_DIST[name];
    if (!p) throw new Error(`Unknown extension "${name}". Known: ${Object.keys(EXTENSION_DIST).join(', ')}`);
    return p;
  });

  const runtime = new DotAiRuntime({
    workspaceRoot: workspaceDir,
    tokenBudget: options.tokenBudget,
    extensions: { paths },
  });

  await runtime.boot();
  const { sections, labels, routing } = await runtime.processPrompt(prompt);
  await runtime.shutdown();

  return new ScenarioResult(sections, labels, routing, workspaceDir, paths);
}
