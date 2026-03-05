import type { EnrichedContext, HooksConfig, HookEntryConfig } from './types.js';
import type { BootCache } from './engine.js';
import type { Logger } from './logger.js';

/** Hook event names matching pipeline stages */
export type HookEvent = 'after_boot' | 'after_enrich' | 'after_format' | 'after_learn';

/** Hook handler signatures per event */
export type AfterBootHook = (cache: BootCache) => Promise<void>;
export type AfterEnrichHook = (ctx: EnrichedContext) => Promise<EnrichedContext | void>;
export type AfterFormatHook = (formatted: string, ctx: EnrichedContext) => Promise<string | void>;
export type AfterLearnHook = (response: string) => Promise<void>;

export type HookHandler = AfterBootHook | AfterEnrichHook | AfterFormatHook | AfterLearnHook;

/** Re-export for convenience */
export type { HookEntryConfig };

/** Resolved hook — a handler function ready to call */
export interface ResolvedHook {
  event: HookEvent;
  handler: HookHandler;
  source: string;  // package name for debugging
}

/**
 * Load and resolve hooks from config.
 * Each entry's package is dynamically imported and its factory called with options.
 * Errors are logged and skipped — never thrown.
 */
export async function loadHooks(
  config: HooksConfig | undefined,
  logger?: Logger,
): Promise<ResolvedHook[]> {
  if (!config) return [];

  const resolved: ResolvedHook[] = [];
  const events: HookEvent[] = ['after_boot', 'after_enrich', 'after_format', 'after_learn'];

  for (const event of events) {
    const entries = config[event];
    if (!entries || entries.length === 0) continue;

    for (const entry of entries) {
      try {
        const mod = await import(entry.use);
        const factory: ((opts: Record<string, unknown>) => HookHandler) | undefined =
          typeof mod.default === 'function'
            ? mod.default
            : typeof mod.createHook === 'function'
            ? mod.createHook
            : undefined;

        if (!factory) {
          logger?.log({
            timestamp: new Date().toISOString(),
            level: 'warn',
            phase: 'boot',
            event: 'hook_no_factory',
            data: { source: entry.use, hookEvent: event },
          });
          continue;
        }

        const handler = factory(entry.with ?? {});

        if (typeof handler !== 'function') {
          logger?.log({
            timestamp: new Date().toISOString(),
            level: 'warn',
            phase: 'boot',
            event: 'hook_invalid_handler',
            data: { source: entry.use, hookEvent: event, type: typeof handler },
          });
          continue;
        }

        resolved.push({ event, handler, source: entry.use });

        logger?.log({
          timestamp: new Date().toISOString(),
          level: 'info',
          phase: 'boot',
          event: 'hook_loaded',
          data: { source: entry.use, hookEvent: event },
        });
      } catch (err) {
        logger?.log({
          timestamp: new Date().toISOString(),
          level: 'warn',
          phase: 'boot',
          event: 'hook_load_error',
          data: {
            source: entry.use,
            hookEvent: event,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  }

  return resolved;
}

/**
 * Run all after_boot hooks sequentially.
 * Errors are caught per hook and logged — never thrown.
 */
export async function runAfterBoot(
  hooks: ResolvedHook[],
  cache: BootCache,
  logger?: Logger,
): Promise<void> {
  const matching = hooks.filter((h) => h.event === 'after_boot');

  for (const hook of matching) {
    logger?.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      phase: 'boot',
      event: 'hook_run',
      data: { source: hook.source, hookEvent: hook.event },
    });

    try {
      await (hook.handler as AfterBootHook)(cache);
    } catch (err) {
      logger?.log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        phase: 'boot',
        event: 'hook_error',
        data: {
          source: hook.source,
          hookEvent: hook.event,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
}

/**
 * Run all after_enrich hooks sequentially.
 * If a hook returns a new context, it replaces the current one for subsequent hooks.
 * Errors are caught per hook and logged — never thrown.
 */
export async function runAfterEnrich(
  hooks: ResolvedHook[],
  ctx: EnrichedContext,
  logger?: Logger,
): Promise<EnrichedContext> {
  const matching = hooks.filter((h) => h.event === 'after_enrich');
  let current = ctx;

  for (const hook of matching) {
    logger?.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      phase: 'enrich',
      event: 'hook_run',
      data: { source: hook.source, hookEvent: hook.event },
    });

    try {
      const result = await (hook.handler as AfterEnrichHook)(current);
      if (result !== undefined && result !== null) {
        current = result;
      }
    } catch (err) {
      logger?.log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        phase: 'enrich',
        event: 'hook_error',
        data: {
          source: hook.source,
          hookEvent: hook.event,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  return current;
}

/**
 * Run all after_format hooks sequentially.
 * If a hook returns a new string, it replaces the current formatted output for subsequent hooks.
 * Errors are caught per hook and logged — never thrown.
 */
export async function runAfterFormat(
  hooks: ResolvedHook[],
  formatted: string,
  ctx: EnrichedContext,
  logger?: Logger,
): Promise<string> {
  const matching = hooks.filter((h) => h.event === 'after_format');
  let current = formatted;

  for (const hook of matching) {
    logger?.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      phase: 'format',
      event: 'hook_run',
      data: { source: hook.source, hookEvent: hook.event },
    });

    try {
      const result = await (hook.handler as AfterFormatHook)(current, ctx);
      if (result !== undefined && result !== null) {
        current = result;
      }
    } catch (err) {
      logger?.log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        phase: 'format',
        event: 'hook_error',
        data: {
          source: hook.source,
          hookEvent: hook.event,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  return current;
}

/**
 * Run all after_learn hooks sequentially.
 * Errors are caught per hook and logged — never thrown.
 */
export async function runAfterLearn(
  hooks: ResolvedHook[],
  response: string,
  logger?: Logger,
): Promise<void> {
  const matching = hooks.filter((h) => h.event === 'after_learn');

  for (const hook of matching) {
    logger?.log({
      timestamp: new Date().toISOString(),
      level: 'info',
      phase: 'learn',
      event: 'hook_run',
      data: { source: hook.source, hookEvent: hook.event },
    });

    try {
      await (hook.handler as AfterLearnHook)(response);
    } catch (err) {
      logger?.log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        phase: 'learn',
        event: 'hook_error',
        data: {
          source: hook.source,
          hookEvent: hook.event,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
}
