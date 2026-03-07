import type { Logger } from './logger.js';
import type {
  LoadedExtension,
  ToolDefinition,
  ToolCallEvent,
  ToolCallResult,
  ExtensionDiagnostic,
  ExtensionContext,
  Section,
  ContextEnrichResult,
  CollectedSections,
  CommandDefinition,
  InputResult,
} from './extension-types.js';
import type { Skill, Identity } from './types.js';

/**
 * Simple event bus for inter-extension communication.
 * In-memory only, no persistence.
 */
export class EventBus {
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  on(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  }

  emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(...args);
      } catch {
        // Silently ignore errors in event bus handlers
      }
    }
  }
}

/**
 * ExtensionRunner — fires events and collects results from loaded extensions.
 */
export class ExtensionRunner {
  private extensions: LoadedExtension[];
  private logger?: Logger;

  constructor(extensions: LoadedExtension[], logger?: Logger) {
    this.extensions = extensions;
    this.logger = logger;
  }

  /**
   * Fire an event and collect results from all extensions.
   * ctx is passed as second argument to handlers (like Pi's ctx pattern).
   * Errors in individual handlers are caught and logged — never thrown.
   */
  async fire<T>(event: string, data?: unknown, ctx?: ExtensionContext): Promise<T[]> {
    const results: T[] = [];

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get(event);
      if (!handlers) continue;

      for (const handler of handlers) {
        try {
          const result = await (handler as (data?: unknown, ctx?: ExtensionContext) => Promise<T | void>)(data, ctx);
          if (result !== undefined && result !== null) {
            results.push(result);
          }
        } catch (err) {
          this.logHandlerError(ext.path, event, err);
        }
      }
    }

    return results;
  }

  /**
   * Fire a tool_call event, stop at first blocking result.
   * Returns the blocking result, or null if all allow.
   */
  async fireUntilBlocked(event: 'tool_call', data: ToolCallEvent, ctx?: ExtensionContext): Promise<ToolCallResult | null> {
    for (const ext of this.extensions) {
      const handlers = ext.handlers.get(event);
      if (!handlers) continue;

      for (const handler of handlers) {
        try {
          const result = await (handler as (data: ToolCallEvent, ctx?: ExtensionContext) => Promise<ToolCallResult | void>)(data, ctx);
          if (result?.decision === 'block') {
            return result;
          }
        } catch (err) {
          this.logHandlerError(ext.path, event, err);
        }
      }
    }

    return null;
  }

  // ── Emission Patterns ──

  /**
   * Fire an event and collect sections from all handlers.
   * Used for `context_enrich` — each handler returns sections and/or systemPrompt fragments.
   * All sections are flattened into a single array; all systemPrompt strings are concatenated.
   */
  async fireCollectSections(event: string, data?: unknown, ctx?: ExtensionContext): Promise<CollectedSections> {
    const sectionMap = new Map<string, Section>();
    const anonymousSections: Section[] = [];
    const systemPromptParts: string[] = [];

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get(event);
      if (!handlers) continue;

      for (const handler of handlers) {
        try {
          const result = await (handler as (data?: unknown, ctx?: ExtensionContext) => Promise<ContextEnrichResult | void>)(data, ctx);
          if (result === undefined || result === null) continue;

          if (result.sections && Array.isArray(result.sections)) {
            for (const section of result.sections) {
              // Sections with the same id are overridden (last-wins)
              if (section.id) {
                sectionMap.set(section.id, section);
              } else {
                anonymousSections.push(section);
              }
            }
          }
          if (result.systemPrompt && typeof result.systemPrompt === 'string') {
            systemPromptParts.push(result.systemPrompt);
          }
        } catch (err) {
          this.logHandlerError(ext.path, event, err);
        }
      }
    }

    return {
      sections: [...sectionMap.values(), ...anonymousSections],
      systemPrompt: systemPromptParts.join('\n'),
    };
  }

  /**
   * Fire an event and return the first non-null/undefined result.
   * Used for `route` — stops at the first handler that returns a value.
   * Returns null if no handler returns a result.
   */
  async fireFirstResult<T>(event: string, data?: unknown, ctx?: ExtensionContext): Promise<T | null> {
    for (const ext of this.extensions) {
      const handlers = ext.handlers.get(event);
      if (!handlers) continue;

      for (const handler of handlers) {
        try {
          const result = await (handler as (data?: unknown, ctx?: ExtensionContext) => Promise<T | void>)(data, ctx);
          if (result !== undefined && result !== null) {
            return result;
          }
        } catch (err) {
          this.logHandlerError(ext.path, event, err);
        }
      }
    }

    return null;
  }

  /**
   * Fire an event as a transform chain — each handler receives the previous handler's output.
   * Used for `label_extract`, `input`, `tool_result`.
   *
   * - Initial value is `data`.
   * - If a handler returns undefined/null, the previous value is kept (no-op).
   * - For `input` events: if the result has `consumed: true`, short-circuits and returns immediately.
   */
  async fireChainTransform<T>(event: string, data: T, ctx?: ExtensionContext): Promise<T> {
    let current: T = data;

    for (const ext of this.extensions) {
      const handlers = ext.handlers.get(event);
      if (!handlers) continue;

      for (const handler of handlers) {
        try {
          const result = await (handler as (data: T, ctx?: ExtensionContext) => Promise<T | void>)(current, ctx);
          if (result !== undefined && result !== null) {
            current = result;

            // Short-circuit for input events when consumed
            if (event === 'input' && (result as unknown as InputResult).consumed === true) {
              return current;
            }
          }
        } catch (err) {
          this.logHandlerError(ext.path, event, err);
        }
      }
    }

    return current;
  }

  // ── Accessors ──

  /** Get all registered tools across extensions (last-wins for overrides) */
  get tools(): ToolDefinition[] {
    const toolMap = new Map<string, ToolDefinition>();

    for (const ext of this.extensions) {
      for (const [name, tool] of ext.tools) {
        if (toolMap.has(name)) {
          this.logger?.log({
            timestamp: new Date().toISOString(),
            level: 'info',
            phase: 'runtime',
            event: 'tool_override',
            data: { tool: name, extension: ext.path },
          });
        }
        toolMap.set(name, tool);
      }
    }

    return Array.from(toolMap.values());
  }

  /** Get all registered commands across extensions (last-wins for overrides) */
  get commands(): CommandDefinition[] {
    const cmdMap = new Map<string, CommandDefinition>();

    for (const ext of this.extensions) {
      if (!ext.commands) continue;
      for (const [name, cmd] of ext.commands) {
        cmdMap.set(name, cmd);
      }
    }

    return Array.from(cmdMap.values());
  }

  /** Get all registered skills across extensions (last-wins for overrides) */
  get skills(): Skill[] {
    const skillMap = new Map<string, Skill>();

    for (const ext of this.extensions) {
      for (const [name, skill] of ext.skills) {
        skillMap.set(name, skill);
      }
    }

    return Array.from(skillMap.values());
  }

  /** Get all registered identities across extensions */
  get identities(): Identity[] {
    const identityMap = new Map<string, Identity>();

    for (const ext of this.extensions) {
      for (const [key, identity] of ext.identities) {
        identityMap.set(key, identity);
      }
    }

    return Array.from(identityMap.values());
  }

  /** Get all vocabulary labels contributed by extensions */
  get vocabularyLabels(): string[] {
    const labels = new Set<string>();

    for (const ext of this.extensions) {
      for (const label of ext.labels) {
        labels.add(label);
      }
    }

    return Array.from(labels);
  }

  /** Get diagnostic info */
  get diagnostics(): ExtensionDiagnostic[] {
    return this.extensions.map(ext => ({
      path: ext.path,
      handlerCounts: Object.fromEntries(
        Array.from(ext.handlers.entries()).map(([k, v]) => [k, v.length]),
      ),
      toolNames: Array.from(ext.tools.keys()),
      commandNames: ext.commands ? Array.from(ext.commands.keys()) : [],
      skillNames: Array.from(ext.skills.keys()),
      identityNames: Array.from(ext.identities.keys()),
    }));
  }

  // ── Private Helpers ──

  private logHandlerError(extPath: string, event: string, err: unknown): void {
    this.logger?.log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      phase: 'runtime',
      event: 'extension_handler_error',
      data: {
        extension: extPath,
        eventName: event,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
