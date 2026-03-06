import { loadConfig } from './config.js';
import { computeChecksum, loadBootCache, writeBootCache } from './boot-cache.js';
import type { FormatOptions } from './format.js';
import { toolDefinitionToCapability } from './capabilities.js';
import type { Capability } from './capabilities.js';
import { discoverExtensions, createV6CollectorAPI } from './extension-loader.js';
import { ExtensionRunner, EventBus } from './extension-runner.js';
import type {
  ToolCallEvent, ToolCallResult, ExtensionDiagnostic,
  ContextInjectEvent, ContextInjectResult,
  Section, ResourcesDiscoverResult, ContextEnrichEvent,
  RouteEvent, RouteResult,
  CommandDefinition,
} from './extension-types.js';
import type { ExtensionContextV6 } from './extension-api.js';
import type { EnrichedContext, ExtensionsConfig, Label, BudgetWarning } from './types.js';
import type { Logger } from './logger.js';
import { NoopLogger } from './logger.js';
import { extractLabels } from './labels.js';

export interface RuntimeOptions {
  /** Workspace root directory (contains .ai/) */
  workspaceRoot: string;
  /** Optional logger */
  logger?: Logger;
  /** Skip identity sections in formatted output (useful when adapter injects them separately) */
  skipIdentities?: boolean;
  /** Max skills in formatted output */
  maxSkills?: number;
  /** Max chars per skill */
  maxSkillLength?: number;
  /** Token budget for formatted output */
  tokenBudget?: number;
  /** Extension configuration */
  extensions?: ExtensionsConfig;
}

export interface ProcessResult {
  /** The formatted context string ready for injection */
  formatted: string;
  /** The enriched context (for adapters that need raw data) */
  enriched: EnrichedContext;
  /** Interactive capabilities built from extensions */
  capabilities: Capability[];
  /** Routing result from route event */
  routing?: RouteResult | null;
  /** Matched labels */
  labels?: Label[];
  /** Sections collected from extensions */
  sections?: Section[];
}

export interface RuntimeDiagnostics {
  extensions: ExtensionDiagnostic[];
  usedTiers: string[];
  capabilityCount: number;
  vocabularySize: number;
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
   * Boot the runtime — loads config, discovers extensions, fires lifecycle events.
   * Call once per session. Safe to call multiple times (idempotent).
   */
  async boot(): Promise<void> {
    if (this.booted) return;

    const start = performance.now();
    const rawConfig = await loadConfig(this.options.workspaceRoot);

    // Create event bus
    this._eventBus = new EventBus();

    // Discover extensions
    const extConfig = this.options.extensions ?? rawConfig.extensions;
    const extPaths = await discoverExtensions(this.options.workspaceRoot, extConfig);

    // Compute checksum for cache invalidation
    const checksum = await computeChecksum(this.options.workspaceRoot, extPaths);

    // Try loading from cache
    const cached = await loadBootCache(this.options.workspaceRoot, checksum);

    // Load extensions via v6 collector API (always needed for handlers)
    const loaded = await this.loadExtensions(extPaths);
    this._runner = new ExtensionRunner(loaded, this.logger);

    if (cached) {
      // Cache hit — use cached vocabulary, skip resources_discover
      this.vocabulary = cached.vocabulary;
      this.logger.log({
        timestamp: new Date().toISOString(),
        level: 'info',
        phase: 'boot',
        event: 'boot_cache_hit',
        data: { checksum, vocabularySize: cached.vocabulary.length },
      });
    } else {
      // Cache miss — fire resources_discover → build vocabulary
      const ctx = this.buildCtx();
      const discoverResults = await this._runner.fire<ResourcesDiscoverResult>(
        'resources_discover', undefined, ctx,
      );

      // Build vocabulary from all extension-contributed labels
      const allLabels = new Set<string>();
      for (const result of discoverResults) {
        if (result.labels && Array.isArray(result.labels)) {
          for (const label of result.labels) {
            allLabels.add(label);
          }
        }
      }
      this.vocabulary = Array.from(allLabels);

      // Write cache
      await writeBootCache(this.options.workspaceRoot, {
        version: 1,
        checksum,
        vocabulary: this.vocabulary,
        extensionPaths: extPaths,
        tools: this._runner.tools.map(t => ({ name: t.name, description: t.description ?? '' })),
        createdAt: new Date().toISOString(),
      });
    }

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
        cacheHit: !!cached,
      },
      durationMs: Math.round(performance.now() - start),
    });

    // Fire session_start (always, regardless of cache)
    const ctx = this.buildCtx();
    await this._runner.fire('session_start', undefined, ctx);

    this.booted = true;
  }

  /**
   * Load extensions using jiti for TypeScript support, falls back to dynamic import.
   */
  private async loadExtensions(extensionPaths: string[]) {
    if (extensionPaths.length === 0) return [];

    let jitiImport: ((id: string) => unknown) | undefined;
    try {
      const { createJiti } = await import('jiti');
      jitiImport = createJiti(import.meta.url, { interopDefault: true });
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
        if (jitiImport) {
          mod = jitiImport(extPath) as Record<string, unknown>;
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
   * 3. Context enrich (collect-sections)
   * 4. Assemble sections by priority
   * 5. Apply token budget trimming
   */
  async processPrompt(prompt: string, formatOverrides?: Partial<FormatOptions>): Promise<ProcessResult> {
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

      // Also fire legacy context_inject for backward compat
      const injectEvent: ContextInjectEvent = { prompt, labels };
      const injectResults = await this._runner.fire<ContextInjectResult>(
        'context_inject', injectEvent, ctx,
      );
      for (const result of injectResults) {
        if (result.inject) {
          sections.push({
            id: `legacy-inject-${sections.length}`,
            title: 'Extension Context',
            content: result.inject,
            priority: 20,
            source: 'legacy',
          });
        }
      }
    }

    // 4. Sort sections by priority DESC
    sections.sort((a, b) => b.priority - a.priority);

    // 5. Apply token budget trimming
    const tokenBudget = formatOverrides?.tokenBudget ?? this.options.tokenBudget;
    if (tokenBudget) {
      sections = this.trimSections(sections, tokenBudget);
    }

    // 6. Assemble sections into formatted markdown
    const formatted = this.assembleSections(sections);

    this.logger.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      phase: 'format',
      event: 'format_complete',
      data: {
        sectionCount: sections.length,
        outputChars: formatted.length,
        estimatedTokens: Math.round(formatted.length / 4),
        routing: routing?.model ?? 'default',
        labels: labels.map(l => l.name),
      },
      durationMs: Math.round(performance.now() - start),
    });

    // Build enriched context for adapters that need it
    const enriched = this.buildEnrichedFromSections(prompt, labels, sections, routing);

    return {
      formatted,
      enriched,
      capabilities: this.caps,
      routing,
      labels,
      sections,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Learn
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Learn from agent response — fires agent_end event.
   * Memory extensions handle storage in their handlers.
   */
  async learn(response: string): Promise<void> {
    if (this._runner) {
      await this._runner.fire('agent_end', { response }, this.buildCtx());
    }
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

  /** Get diagnostics including extensions */
  get diagnostics(): RuntimeDiagnostics {
    return {
      extensions: this._runner?.diagnostics ?? [],
      usedTiers: this._runner ? Array.from(this._runner.usedTiers) : [],
      capabilityCount: this.caps.length,
      vocabularySize: this.vocabulary.length,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Helpers
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Assemble sorted sections into a single markdown string.
   */
  private assembleSections(sections: Section[]): string {
    if (sections.length === 0) return '';

    return sections
      .map(s => {
        if (s.title) {
          return `## ${s.title}\n\n${s.content}`;
        }
        return s.content;
      })
      .join('\n\n---\n\n');
  }

  /**
   * Trim sections to fit within a token budget.
   * Respects trimStrategy: 'never' sections are never removed.
   */
  private trimSections(sections: Section[], budget: number): Section[] {
    const estimateTokens = (secs: Section[]) =>
      Math.round(secs.map(s => `## ${s.title}\n\n${s.content}`).join('\n\n---\n\n').length / 4);

    let current = estimateTokens(sections);
    if (current <= budget) return sections;

    const result = [...sections];
    const actions: string[] = [];

    // Strategy 1: Truncate 'truncate' sections
    for (let i = result.length - 1; i >= 0; i--) {
      if (current <= budget) break;
      const s = result[i];
      if (s.trimStrategy === 'truncate' && s.content.length > 2000) {
        result[i] = { ...s, content: s.content.slice(0, 2000) + '\n\n[...truncated]' };
        actions.push(`truncated section: ${s.id}`);
        current = estimateTokens(result);
      }
    }

    // Strategy 2: Drop non-'never' sections (lowest priority first)
    for (let i = result.length - 1; i >= 0; i--) {
      if (current <= budget) break;
      const s = result[i];
      if (s.trimStrategy !== 'never') {
        actions.push(`dropped section: ${s.id} (priority ${s.priority})`);
        result.splice(i, 1);
        current = estimateTokens(result);
      }
    }

    if (actions.length > 0) {
      const warning: BudgetWarning = { budget, actual: current, actions };
      this.logger.log({
        timestamp: new Date().toISOString(),
        level: current > budget ? 'warn' : 'info',
        phase: 'format',
        event: 'budget_trimmed',
        data: warning as unknown as Record<string, unknown>,
      });
    }

    return result;
  }

  /**
   * Build a backward-compatible EnrichedContext from pipeline output.
   * Adapters that log enriched fields still work.
   */
  private buildEnrichedFromSections(
    prompt: string,
    labels: Label[],
    sections: Section[],
    routing: RouteResult | null,
  ): EnrichedContext {
    return {
      prompt,
      labels,
      identities: sections
        .filter(s => s.source === 'identity' || s.priority >= 80)
        .map(s => ({
          type: s.id ?? s.source,
          content: s.content,
          source: s.source,
          priority: s.priority,
        })),
      memories: [],
      skills: [],
      tools: [],
      routing: routing ?? { model: 'default', reason: 'no routing extensions' },
    };
  }
}
