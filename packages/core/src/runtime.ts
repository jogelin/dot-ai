import { loadConfig, injectRoot } from './config.js';
import { registerDefaults, registerProvider, createProviders } from './loader.js';
import { boot, enrich, learn } from './engine.js';
import type { Providers, BootCache } from './engine.js';
import { formatContext, applyFormatHooks } from './format.js';
import type { FormatOptions } from './format.js';
import { loadHooks } from './hooks.js';
import type { ResolvedHook } from './hooks.js';
import { buildCapabilities } from './capabilities.js';
import type { Capability } from './capabilities.js';
import type { EnrichedContext } from './types.js';
import type { Logger } from './logger.js';
import { NoopLogger } from './logger.js';

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
   * Explicit provider factory overrides. Bypasses the registry-based resolution.
   * Use when the registry isn't shared across module scopes (e.g., jiti in OpenClaw).
   * Keys are package names (e.g., "@dot-ai/provider-sqlite-memory").
   */
  providerFactories?: Record<string, (options: Record<string, unknown>) => unknown>;
  /**
   * Pre-built providers. Bypasses config loading and provider creation entirely.
   * Use when the adapter has direct access to provider constructors.
   */
  providers?: Providers;
}

export interface ProcessResult {
  /** The formatted context string ready for injection */
  formatted: string;
  /** The enriched context (for adapters that need raw data) */
  enriched: EnrichedContext;
  /** Interactive capabilities built from providers */
  capabilities: Capability[];
}

/**
 * DotAiRuntime — encapsulates the full pipeline lifecycle.
 * Boot once, process many prompts. Adapters instantiate this instead of
 * wiring loadConfig→createProviders→boot→enrich→format manually.
 */
export class DotAiRuntime {
  private _providers: Providers | null = null;
  private cache: BootCache | null = null;
  private hooks: ResolvedHook[] = [];
  private caps: Capability[] = [];
  private booted = false;
  private readonly options: RuntimeOptions;
  private readonly logger: Logger;

  constructor(options: RuntimeOptions) {
    this.options = options;
    this.logger = options.logger ?? new NoopLogger();
  }

  /**
   * Boot the runtime — loads config, creates providers, boots cache.
   * Call once per session. Safe to call multiple times (idempotent).
   */
  async boot(): Promise<void> {
    if (this.booted) return;

    const rawConfig = await loadConfig(this.options.workspaceRoot);
    this.hooks = await loadHooks(rawConfig.hooks, this.logger);

    if (this.options.providers) {
      // Use pre-built providers directly (bypasses config resolution + dynamic import)
      this._providers = this.options.providers;
    } else {
      registerDefaults();
      // Register explicit provider factories if provided (bypasses dynamic import)
      if (this.options.providerFactories) {
        for (const [name, factory] of Object.entries(this.options.providerFactories)) {
          registerProvider(name, factory as (options: Record<string, unknown>) => unknown);
        }
      }
      const config = injectRoot(rawConfig, this.options.workspaceRoot);
      this._providers = await createProviders(config);
    }

    this.cache = await boot(this._providers, this.logger, this.hooks);
    this.caps = buildCapabilities(this._providers);
    this.booted = true;
  }

  /**
   * Process a prompt through the full pipeline:
   * enrich → load skill content → format → apply hooks
   */
  async processPrompt(prompt: string, formatOverrides?: Partial<FormatOptions>): Promise<ProcessResult> {
    if (!this.booted || !this._providers || !this.cache) {
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

    return { formatted, enriched, capabilities: this.caps };
  }

  /**
   * Learn from agent response — stores in memory + runs after_learn hooks.
   */
  async learn(response: string): Promise<void> {
    if (!this._providers) return;
    await learn(response, this._providers, this.hooks, this.logger);
  }

  /** Get the interactive capabilities (for registering as tools) */
  get capabilities(): Capability[] {
    return this.caps;
  }

  /** Get the underlying providers (for direct access) */
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
}
