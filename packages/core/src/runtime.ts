import { loadConfig } from './config.js';
import { toolDefinitionToCapability } from './capabilities.js';
import type { Capability } from './capabilities.js';
import { discoverExtensions, createV6CollectorAPI } from './extension-loader.js';
import { ensurePackagesInstalled } from './package-manager.js';
import { ExtensionRunner, EventBus } from './extension-runner.js';
import type {
  ToolCallEvent, ToolCallResult, ExtensionDiagnostic,
  Section, ContextEnrichEvent,
  RouteEvent, RouteResult,
  CommandDefinition, ToolDefinition,
} from './extension-types.js';
import type { ExtensionContextV6 } from './extension-api.js';
import type { Label, Skill, Identity, ExtensionsConfig } from './types.js';
import type { Logger } from './logger.js';
import { NoopLogger } from './logger.js';
import { extractLabels } from './labels.js';

export interface RuntimeOptions {
  /** Workspace root directory (contains .ai/) */
  workspaceRoot: string;
  /** Optional logger */
  logger?: Logger;
  /** Token budget for formatted output */
  tokenBudget?: number;
  /** Extension configuration */
  extensions?: ExtensionsConfig;
}

/**
 * v7 ProcessResult — structured data only.
 * Adapters handle formatting via formatSections() utility.
 */
export interface ProcessResult {
  /** Sections collected from extensions, sorted by priority DESC */
  sections: Section[];
  /** Matched labels */
  labels: Label[];
  /** Routing result from route event */
  routing: RouteResult | null;
}

export interface RuntimeDiagnostics {
  extensions: ExtensionDiagnostic[];
  capabilityCount: number;
  vocabularySize: number;
  skillCount: number;
  identityCount: number;
}

/**
 * DotAiRuntime — encapsulates the full extension-based pipeline lifecycle.
 * Boot once, process many prompts.
 */
export class DotAiRuntime {
  private caps: Capability[] = [];
  private booted = false;
  private readonly options: RuntimeOptions;
  private readonly logger: Logger;
  private _runner: ExtensionRunner | null = null;
  private _eventBus: EventBus | null = null;
  private vocabulary: string[] = [];

  constructor(options: RuntimeOptions) {
    this.options = options;
    this.logger = options.logger ?? new NoopLogger();
  }

  // ── Context Builder ──

  private buildCtx(labels: Label[] = []): ExtensionContextV6 {
    return {
      workspaceRoot: this.options.workspaceRoot,
      events: this._eventBus ?? { on: () => {}, off: () => {}, emit: () => {} },
      labels,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Boot
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Boot the runtime — loads config, discovers extensions, builds vocabulary from registrations.
   * Call once per session. Safe to call multiple times (idempotent).
   */
  async boot(): Promise<void> {
    if (this.booted) return;

    const start = performance.now();
    const rawConfig = await loadConfig(this.options.workspaceRoot);

    // Create event bus
    this._eventBus = new EventBus();

    // Auto-install packages from settings.json before discovery
    const extConfig = this.options.extensions ?? rawConfig.extensions;
    if (extConfig?.packages?.length) {
      const installResult = await ensurePackagesInstalled(
        this.options.workspaceRoot,
        extConfig.packages,
      );
      if (installResult.installed.length > 0 || installResult.errors.length > 0) {
        this.logger.log({
          timestamp: new Date().toISOString(),
          level: installResult.errors.length > 0 ? 'warn' : 'info',
          phase: 'boot',
          event: 'packages_installed',
          data: {
            installed: installResult.installed,
            skipped: installResult.skipped,
            errors: installResult.errors,
          },
        });
      }
    }

    // Discover extensions
    const extPaths = await discoverExtensions(this.options.workspaceRoot, extConfig);

    // Load extensions via collector API
    // Extension factories run here — they call registerSkill(), registerIdentity(),
    // contributeLabels(), registerTool(), registerCommand(), and subscribe to events.
    const loaded = await this.loadExtensions(extPaths);
    this._runner = new ExtensionRunner(loaded, this.logger);

    // Build vocabulary from registered resources (replaces resources_discover)
    this.vocabulary = this._runner.vocabularyLabels;

    // Build capabilities from extension-registered tools
    this.caps = this._runner.tools.map(toolDefinitionToCapability);

    this.logger.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      phase: 'boot',
      event: 'boot_complete',
      data: {
        extensionCount: loaded.length,
        vocabularySize: this.vocabulary.length,
        toolCount: this._runner.tools.length,
        commandCount: this._runner.commands.length,
        skillCount: this._runner.skills.length,
        identityCount: this._runner.identities.length,
      },
      durationMs: Math.round(performance.now() - start),
    });

    // Fire session_start (always)
    const ctx = this.buildCtx();
    await this._runner.fire('session_start', undefined, ctx);

    this.booted = true;
  }

  /**
   * Load extensions using jiti for TypeScript support, falls back to dynamic import.
   */
  private async loadExtensions(extensionPaths: string[]) {
    if (extensionPaths.length === 0) return [];

    let _jitiLoader: ((id: string) => unknown) | undefined;
    try {
      const { createJiti } = await import('jiti');
      _jitiLoader = createJiti(import.meta.url, { interopDefault: true });
    } catch {
      this.logger.log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        phase: 'boot',
        event: 'jiti_not_available',
        data: { message: 'jiti not installed, falling back to dynamic import' },
      });
    }

    const loaded: Array<import('./extension-types.js').LoadedExtension> = [];

    for (const extPath of extensionPaths) {
      try {
        let mod: Record<string, unknown>;
        if (_jitiLoader) {
          mod = _jitiLoader(extPath) as Record<string, unknown>;
        } else {
          mod = await import(extPath) as Record<string, unknown>;
        }

        const factory = (typeof mod.default === 'function' ? mod.default : mod) as
          ((api: unknown) => void | Promise<void>) | undefined;

        if (typeof factory !== 'function') {
          this.logger.log({
            timestamp: new Date().toISOString(),
            level: 'warn',
            phase: 'boot',
            event: 'extension_no_factory',
            data: { path: extPath },
          });
          continue;
        }

        // TODO: resolve per-extension config from settings.json `with:` block
        const extConfig: Record<string, unknown> = {};

        const { api, extension } = createV6CollectorAPI(extPath, extConfig, this._eventBus!, this.options.workspaceRoot);
        await factory(api);
        loaded.push(extension);

        this.logger.log({
          timestamp: new Date().toISOString(),
          level: 'info',
          phase: 'boot',
          event: 'extension_loaded',
          data: {
            path: extPath,
            handlers: Object.fromEntries(
              Array.from(extension.handlers.entries()).map(([k, v]) => [k, v.length]),
            ),
            tools: Array.from(extension.tools.keys()),
            commands: Array.from(extension.commands.keys()),
            skills: Array.from(extension.skills.keys()),
            identities: Array.from(extension.identities.keys()),
          },
        });
      } catch (err) {
        this.logger.log({
          timestamp: new Date().toISOString(),
          level: 'warn',
          phase: 'boot',
          event: 'extension_load_error',
          data: {
            path: extPath,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    return loaded;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Process Prompt
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Process a prompt through the pipeline:
   * 1. Extract labels (core regex + label_extract chain-transform)
   * 2. Route (first-result)
   * 3. Context enrich (collect-sections) + core system section
   * 4. Sort sections by priority DESC
   *
   * Returns structured data. Adapters call formatSections() to get markdown.
   */
  async processPrompt(prompt: string): Promise<ProcessResult> {
    if (!this.booted) {
      await this.boot();
    }

    const start = performance.now();

    // 1. Extract labels from prompt using vocabulary
    let labels = extractLabels(prompt, this.vocabulary);

    // Chain-transform via label_extract event
    if (this._runner) {
      const ctx = this.buildCtx(labels);
      const enrichedLabels = await this._runner.fireChainTransform<Label[]>(
        'label_extract', labels, ctx,
      );
      if (enrichedLabels && Array.isArray(enrichedLabels)) {
        labels = enrichedLabels;
      }
    }

    this.logger.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      phase: 'enrich',
      event: 'labels_extracted',
      data: { labels: labels.map(l => l.name), vocabularySize: this.vocabulary.length },
      durationMs: Math.round(performance.now() - start),
    });

    // 2. Route (first-result)
    let routing: RouteResult | null = null;
    if (this._runner) {
      const routeEvent: RouteEvent = { labels };
      const ctx = this.buildCtx(labels);
      routing = await this._runner.fireFirstResult<RouteResult>('route', routeEvent, ctx);
    }

    // 3. Context enrich (collect-sections)
    let sections: Section[] = [];
    if (this._runner) {
      const enrichEvent: ContextEnrichEvent = { prompt, labels };
      const ctx = this.buildCtx(labels);
      const collected = await this._runner.fireCollectSections('context_enrich', enrichEvent, ctx);
      sections = collected.sections;
    }

    // Add core system section with architecture overview + skill catalog
    if (this._runner) {
      const allSkills = this._runner.skills;
      const toolNames = this._runner.tools.map(t => t.name);

      // Identify which skills were injected in this turn
      const injectedSkillIds = new Set(
        sections.filter(s => s.id?.startsWith('skill:')).map(s => s.id!.replace('skill:', '')),
      );

      const archLines = [
        'Context managed by **dot-ai** — reads `.ai/` in workspace, injects relevant sections per-turn.',
        'Identity (`.ai/*.md`) always present. Skills, memory, tasks, project agents injected when relevant.',
        'Source of truth: `.ai/` directory. Do NOT edit agent workspace files for context.',
      ];

      if (toolNames.length > 0) archLines.push(`Tools: ${toolNames.join(', ')}.`);

      // Skill catalog: show injected skills, then list available (non-injected) skills by name
      if (allSkills.length > 0) {
        const nonInjected = allSkills.filter(s => !injectedSkillIds.has(s.name));
        if (injectedSkillIds.size > 0) {
          archLines.push(`Active skills: ${[...injectedSkillIds].join(', ')}.`);
        }
        if (nonInjected.length > 0) {
          // Show up to 15 non-injected skill names for awareness
          const shown = nonInjected.slice(0, 15).map(s => s.name);
          const remaining = nonInjected.length - shown.length;
          let catalogLine = `Other skills: ${shown.join(', ')}`;
          if (remaining > 0) catalogLine += ` (+${remaining} more)`;
          catalogLine += '. Ask to load any skill by name.';
          archLines.push(catalogLine);
        }
      }

      sections.push({
        id: 'dot-ai:system',
        title: 'dot-ai',
        content: archLines.join('\n'),
        priority: 95,
        source: 'core',
        trimStrategy: 'never',
      });
    }

    // 4. Sort sections by priority DESC
    sections.sort((a, b) => b.priority - a.priority);

    this.logger.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      phase: 'enrich',
      event: 'prompt_processed',
      data: {
        sectionCount: sections.length,
        routing: routing?.model ?? 'default',
        labels: labels.map(l => l.name),
      },
      durationMs: Math.round(performance.now() - start),
    });

    return { sections, labels, routing };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Tool Execution
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Execute a registered tool by name.
   */
  async executeTool(name: string, input: Record<string, unknown>): Promise<{ content: string; details?: unknown; isError?: boolean }> {
    if (!this._runner) throw new Error('Runtime not booted');
    const tool = this._runner.tools.find(t => t.name === name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    return tool.execute(input, this.buildCtx());
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Event Firing
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Fire an event (for adapters to call on agent-native events).
   */
  async fire<T>(event: string, data?: unknown): Promise<T[]> {
    if (!this._runner) return [];
    return this._runner.fire<T>(event, data, this.buildCtx());
  }

  /**
   * Fire a tool_call event and return block result if any.
   */
  async fireToolCall(event: ToolCallEvent): Promise<ToolCallResult | null> {
    if (!this._runner) return null;
    return this._runner.fireUntilBlocked('tool_call', event, this.buildCtx());
  }

  /**
   * Shutdown: fire session_end, flush logger.
   */
  async shutdown(): Promise<void> {
    if (this._runner) {
      await this._runner.fire('session_end', undefined, this.buildCtx());
    }
    await this.logger.flush();
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Accessors
  // ══════════════════════════════════════════════════════════════════════════════

  /** Get the interactive capabilities (for registering as tools) */
  get capabilities(): Capability[] {
    return this.caps;
  }

  /** Check if runtime has been booted */
  get isBooted(): boolean {
    return this.booted;
  }

  /** Flush logger buffers — call before process exit in CLI hooks */
  async flush(): Promise<void> {
    await this.logger.flush();
  }

  /** Get the extension runner */
  get runner(): ExtensionRunner | null {
    return this._runner;
  }

  /** Get registered commands from extensions */
  get commands(): CommandDefinition[] {
    return this._runner?.commands ?? [];
  }

  /** Get registered skills from extensions */
  get skills(): Skill[] {
    return this._runner?.skills ?? [];
  }

  /** Get registered identities from extensions */
  get identities(): Identity[] {
    return this._runner?.identities ?? [];
  }

  /** Get registered tools from extensions */
  get tools(): ToolDefinition[] {
    return this._runner?.tools ?? [];
  }

  /** Get diagnostics including extensions */
  get diagnostics(): RuntimeDiagnostics {
    return {
      extensions: this._runner?.diagnostics ?? [],
      capabilityCount: this.caps.length,
      vocabularySize: this.vocabulary.length,
      skillCount: this._runner?.skills.length ?? 0,
      identityCount: this._runner?.identities.length ?? 0,
    };
  }
}
