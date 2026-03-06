import { loadConfig, injectRoot } from './config.js';
import { computeChecksum, loadBootCache, writeBootCache } from './boot-cache.js';
import { registerProvider, createProviders } from './loader.js';
import { boot, enrich, learn } from './engine.js';
import type { Providers, BootCache } from './engine.js';
import { formatContext, applyFormatHooks } from './format.js';
import type { FormatOptions } from './format.js';
import { loadHooks } from './hooks.js';
import type { ResolvedHook } from './hooks.js';
import { buildCapabilities, toolDefinitionToCapability } from './capabilities.js';
import type { Capability } from './capabilities.js';
import { discoverExtensions, loadExtensions, createV6CollectorAPI } from './extension-loader.js';
import { ExtensionRunner, EventBus } from './extension-runner.js';
import type {
  ToolCallEvent, ToolCallResult, ExtensionDiagnostic,
  ContextInjectEvent, ContextInjectResult,
  Section, ResourcesDiscoverResult, ContextEnrichEvent,
  RouteEvent, RouteResult,
  CommandDefinition,
} from './extension-types.js';
import type { ExtensionContextV6 } from './extension-api.js';
import type { DotAiExtensionContext } from './extension-api.js';
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
  /**
   * @deprecated Use extensions instead. Will be removed in v7.
   * Explicit provider factory overrides.
   */
  providerFactories?: Record<string, (options: Record<string, unknown>) => unknown>;
  /**
   * @deprecated Use extensions instead. Will be removed in v7.
   * Pre-built providers.
   */
  providers?: Providers;
  /** Extension configuration */
  extensions?: ExtensionsConfig;
}

export interface ProcessResult {
  /** The formatted context string ready for injection */
  formatted: string;
  /** The enriched context (for adapters that need raw data) */
  enriched: EnrichedContext;
  /** Interactive capabilities built from providers/extensions */
  capabilities: Capability[];
  /** Routing result from route event (v6) */
  routing?: RouteResult | null;
  /** Matched labels (v6) */
  labels?: Label[];
  /** Sections collected from extensions (v6) */
  sections?: Section[];
}

export interface RuntimeDiagnostics {
  extensions: ExtensionDiagnostic[];
  usedTiers: string[];
  providerStatus: Record<string, boolean>;
  capabilityCount: number;
  /** Whether runtime is using v6 extension pipeline */
  v6: boolean;
  /** Vocabulary size (v6 only) */
  vocabularySize?: number;
}

/**
 * DotAiRuntime — encapsulates the full pipeline lifecycle.
 *
 * Supports two modes:
 * - **v6 (extension-based):** No providers passed — boots extensions, fires events.
 *   This is the default and recommended mode.
 * - **Legacy (provider-based):** `options.providers` or `options.providerFactories` set.
 *   Uses engine.ts boot/enrich/learn. Deprecated, will be removed in v7.
 *
 * Boot once, process many prompts.
 */
export class DotAiRuntime {
  // Legacy state
  private _providers: Providers | null = null;
  private cache: BootCache | null = null;
  private hooks: ResolvedHook[] = [];

  // Shared state
  private caps: Capability[] = [];
  private booted = false;
  private readonly options: RuntimeOptions;
  private readonly logger: Logger;
  private _runner: ExtensionRunner | null = null;
  private _eventBus: EventBus | null = null;

  // v6 state
  private vocabulary: string[] = [];
  private _isV6 = false;

  constructor(options: RuntimeOptions) {
    this.options = options;
    this.logger = options.logger ?? new NoopLogger();
  }

  /** Whether this runtime uses the v6 extension pipeline */
  get isV6(): boolean {
    return this._isV6;
  }

  // ── v6 Context Builder ──

  /** Build the v6 extension context passed to event handlers */
  private buildV6Ctx(labels: Label[] = []): ExtensionContextV6 {
    return {
      workspaceRoot: this.options.workspaceRoot,
      events: this._eventBus ?? { on: () => {}, off: () => {}, emit: () => {} },
      labels,
    };
  }

  // ── Legacy Context Builder ──

  /** @deprecated Build the legacy extension context */
  private buildLegacyCtx(): DotAiExtensionContext {
    return {
      workspaceRoot: this.options.workspaceRoot,
      events: this._eventBus ?? { on: () => {}, off: () => {}, emit: () => {} },
      providers: {
        memory: this._providers?.memory ? {
          search: (query: string, labels?: string[]) => this._providers!.memory!.search(query, labels),
          store: (entry) => this._providers!.memory!.store(entry),
        } : undefined,
        skills: this._providers?.skills ? {
          match: (labels) => this._providers!.skills!.match(labels),
          load: (name) => this._providers!.skills!.load(name),
        } : undefined,
        routing: this._providers?.routing ? {
          route: (labels) => this._providers!.routing!.route(labels),
        } : undefined,
        tasks: this._providers?.tasks ? {
          list: (filter) => this._providers!.tasks!.list(filter),
          get: (id) => this._providers!.tasks!.get(id),
          create: (task) => this._providers!.tasks!.create(task),
          update: (id, patch) => this._providers!.tasks!.update(id, patch),
        } : undefined,
      },
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

    const useLegacy = !!(this.options.providers || this.options.providerFactories);
    this._isV6 = !useLegacy;

    if (useLegacy) {
      await this.bootLegacy();
    } else {
      await this.bootV6();
    }

    this.booted = true;
  }

  /**
   * v6 boot: extension-only pipeline.
   * 1. Read config
   * 2. Create EventBus
   * 3. Discover + load extensions via v6 API
   * 4. Fire resources_discover → build vocabulary
   * 5. Fire session_start
   * 6. Build capabilities from extension tools
   */
  private async bootV6(): Promise<void> {
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
    const loaded = await this.loadExtensionsV6(extPaths);
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
      const ctx = this.buildV6Ctx();
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
      event: 'boot_v6_complete',
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
    const ctx = this.buildV6Ctx();
    await this._runner.fire('session_start', undefined, ctx);
  }

  /**
   * Load extensions using v6 collector API.
   * Uses jiti for TypeScript support, falls back to dynamic import.
   */
  private async loadExtensionsV6(extensionPaths: string[]) {
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
          event: 'extension_loaded_v6',
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

  /**
   * @deprecated Legacy boot: provider-based pipeline.
   */
  private async bootLegacy(): Promise<void> {
    const rawConfig = await loadConfig(this.options.workspaceRoot);
    this.hooks = await loadHooks(rawConfig.hooks, this.logger);

    if (this.options.providers) {
      this._providers = this.options.providers;
    } else {
      // registerDefaults() removed — all providers are opt-in via config
      if (this.options.providerFactories) {
        for (const [name, factory] of Object.entries(this.options.providerFactories)) {
          registerProvider(name, factory as (options: Record<string, unknown>) => unknown);
        }
      }
      const config = injectRoot(rawConfig, this.options.workspaceRoot);
      this._providers = await createProviders(config);
    }

    this.cache = await boot(this._providers, this.logger, this.hooks);

    // Load extensions (legacy mode — with providers)
    const extConfig = this.options.extensions ?? rawConfig.extensions;
    this._eventBus = new EventBus();
    const extPaths = await discoverExtensions(this.options.workspaceRoot, extConfig);
    const loaded = await loadExtensions(extPaths, this._providers, this._eventBus, this.logger);
    this._runner = new ExtensionRunner(loaded, this.logger);

    // Build capabilities with extension tools
    this.caps = buildCapabilities(this._providers, this._runner.tools);

    // Fire session_start after boot
    await this._runner.fire('session_start', undefined, this.buildLegacyCtx());
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Process Prompt
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Process a prompt through the pipeline.
   *
   * v6 path: label_extract → route → context_enrich → assemble sections → trim
   * Legacy path: enrich → format → context_inject
   */
  async processPrompt(prompt: string, formatOverrides?: Partial<FormatOptions>): Promise<ProcessResult> {
    if (!this.booted) {
      await this.boot();
    }

    if (this._isV6) {
      return this.processPromptV6(prompt, formatOverrides);
    } else {
      return this.processPromptLegacy(prompt, formatOverrides);
    }
  }

  /**
   * v6 prompt processing:
   * 1. Extract labels (core regex + label_extract chain-transform)
   * 2. Route (first-result)
   * 3. Context enrich (collect-sections)
   * 4. Assemble sections by priority
   * 5. Apply token budget trimming
   */
  private async processPromptV6(prompt: string, formatOverrides?: Partial<FormatOptions>): Promise<ProcessResult> {
    const start = performance.now();

    // 1. Extract labels from prompt using vocabulary
    let labels = extractLabels(prompt, this.vocabulary);

    // Chain-transform via label_extract event
    if (this._runner) {
      const ctx = this.buildV6Ctx(labels);
      const enrichedLabels = await this._runner.fireChainTransform<Label[]>(
        'label_extract', labels, ctx,
      );
      // If handler returned the LabelExtractEvent instead of labels array, extract labels
      if (enrichedLabels && Array.isArray(enrichedLabels)) {
        labels = enrichedLabels;
      }
    }

    this.logger.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      phase: 'enrich',
      event: 'labels_extracted_v6',
      data: { labels: labels.map(l => l.name), vocabularySize: this.vocabulary.length },
      durationMs: Math.round(performance.now() - start),
    });

    // 2. Route (first-result)
    let routing: RouteResult | null = null;
    if (this._runner) {
      const routeEvent: RouteEvent = { labels };
      const ctx = this.buildV6Ctx(labels);
      routing = await this._runner.fireFirstResult<RouteResult>('route', routeEvent, ctx);
    }

    // 3. Context enrich (collect-sections)
    let sections: Section[] = [];
    if (this._runner) {
      const enrichEvent: ContextEnrichEvent = { prompt, labels };
      const ctx = this.buildV6Ctx(labels);
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

    // 5. Apply token budget trimming (formatOverrides.tokenBudget takes precedence)
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
      event: 'format_v6_complete',
      data: {
        sectionCount: sections.length,
        outputChars: formatted.length,
        estimatedTokens: Math.round(formatted.length / 4),
        routing: routing?.model ?? 'default',
        labels: labels.map(l => l.name),
      },
      durationMs: Math.round(performance.now() - start),
    });

    // Build backward-compat enriched context
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

  /**
   * @deprecated Legacy prompt processing using providers.
   */
  private async processPromptLegacy(prompt: string, formatOverrides?: Partial<FormatOptions>): Promise<ProcessResult> {
    if (!this._providers || !this.cache) {
      await this.boot();
    }

    // Enrich
    const enriched = await enrich(prompt, this._providers!, this.cache!, this.logger, this.hooks);

    // Load skill content for matched skills that don't have it yet
    if (this._providers!.skills) {
      for (const skill of enriched.skills) {
        if (!skill.content && skill.name) {
          skill.content = await this._providers!.skills.load(skill.name) ?? undefined;
        }
      }
    }

    // Format
    const formatOpts: FormatOptions = {
      skipIdentities: this.options.skipIdentities,
      maxSkills: this.options.maxSkills,
      maxSkillLength: this.options.maxSkillLength,
      tokenBudget: this.options.tokenBudget,
      logger: this.logger,
      ...formatOverrides,
    };

    let formatted = formatContext(enriched, formatOpts);

    // Apply after_format hooks
    if (this.hooks.length > 0) {
      formatted = await applyFormatHooks(formatted, enriched, this.hooks, this.logger);
    }

    // Fire context_inject and append results
    if (this._runner) {
      const injectEvent: ContextInjectEvent = {
        prompt,
        labels: enriched.labels,
      };
      const results = await this._runner.fire<ContextInjectResult>('context_inject', injectEvent, this.buildLegacyCtx());
      for (const result of results) {
        if (result.inject) {
          formatted += '\n\n---\n\n' + result.inject;
        }
      }
    }

    return { formatted, enriched, capabilities: this.caps };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Learn
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Learn from agent response — fires agent_end event.
   * In legacy mode, also stores via memory provider.
   */
  async learn(response: string): Promise<void> {
    if (this._isV6) {
      // v6: just fire agent_end — memory extension handles storage in its handler
      if (this._runner) {
        await this._runner.fire('agent_end', { response }, this.buildV6Ctx());
      }
    } else {
      // Legacy: use engine.learn + fire agent_end
      if (this._providers) {
        await learn(response, this._providers, this.hooks, this.logger);
      }
      if (this._runner) {
        await this._runner.fire('agent_end', { response }, this.buildLegacyCtx());
      }
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
    const ctx = this._isV6 ? this.buildV6Ctx() : this.buildLegacyCtx();
    return this._runner.fire<T>(event, data, ctx);
  }

  /**
   * Fire a tool_call event and return block result if any.
   */
  async fireToolCall(event: ToolCallEvent): Promise<ToolCallResult | null> {
    if (!this._runner) return null;
    const ctx = this._isV6 ? this.buildV6Ctx() : this.buildLegacyCtx();
    return this._runner.fireUntilBlocked('tool_call', event, ctx);
  }

  /**
   * Shutdown: fire session_end, flush logger.
   */
  async shutdown(): Promise<void> {
    if (this._runner) {
      const ctx = this._isV6 ? this.buildV6Ctx() : this.buildLegacyCtx();
      await this._runner.fire('session_end', undefined, ctx);
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

  /**
   * @deprecated Will be removed in v7. Use extension events instead.
   * Get the underlying providers (for direct access).
   */
  get providers(): Providers | null {
    return this._providers;
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
    const providerStatus: Record<string, boolean> = {};
    if (!this._isV6) {
      const keys = ['memory', 'skills', 'identity', 'routing', 'tasks', 'tools'] as const;
      for (const key of keys) {
        providerStatus[key] = this._providers != null && this._providers[key] != null;
      }
    }

    return {
      extensions: this._runner?.diagnostics ?? [],
      usedTiers: this._runner ? Array.from(this._runner.usedTiers) : [],
      providerStatus,
      capabilityCount: this.caps.length,
      v6: this._isV6,
      vocabularySize: this._isV6 ? this.vocabulary.length : undefined,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // v6 Helpers
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Assemble sorted sections into a single markdown string.
   * Sections are joined with horizontal rules.
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

    // Strategy 1: Truncate 'truncate' sections (keep section, shorten content to 2000 chars)
    for (let i = result.length - 1; i >= 0; i--) {
      if (current <= budget) break;
      const s = result[i];
      if (s.trimStrategy === 'truncate' && s.content.length > 2000) {
        result[i] = { ...s, content: s.content.slice(0, 2000) + '\n\n[...truncated]' };
        actions.push(`truncated section: ${s.id}`);
        current = estimateTokens(result);
      }
    }

    // Strategy 2: Drop 'drop' sections (lowest priority first — they're at end since sorted DESC)
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
        event: 'budget_trimmed_v6',
        data: warning as unknown as Record<string, unknown>,
      });
    }

    return result;
  }

  /**
   * Build a backward-compatible EnrichedContext from v6 pipeline output.
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
