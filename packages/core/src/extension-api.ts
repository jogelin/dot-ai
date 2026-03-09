import type {
  ToolCallEvent, ToolCallResult,
  ToolResultEvent,
  AgentEndEvent,
  ToolDefinition,
  ExtensionContext,
  LabelExtractEvent,
  ContextEnrichEvent, ContextEnrichResult,
  RouteEvent, RouteResult,
  InputEvent, InputResult,
  CommandDefinition,
} from './extension-types.js';
import type { Label, Skill, Identity } from './types.js';

/**
 * v7 Extension Context — passed as second argument to every event handler.
 * Extends the base ExtensionContext with labels and optional agent capabilities.
 */
export interface ExtensionContextV6 extends ExtensionContext {
  /** Current prompt labels (available after label_extract) */
  labels: Label[];

  /** Agent capabilities (adapter-provided, may be undefined) */
  agent?: {
    abort(): void;
    getContextUsage(): { tokens: number; percent: number } | undefined;
    getSystemPrompt(): string;
    [key: string]: unknown;
  };
}

/**
 * Extension API — passed to extension factory functions.
 * Pi-compatible: same on(event) + registerTool() + registerCommand() pattern.
 */
export interface ExtensionAPI {
  // ── Event subscription ──

  /** Label extraction: extensions can add custom labels (chain-transform) */
  on(event: 'label_extract', handler: (e: LabelExtractEvent, ctx: ExtensionContextV6) => Promise<Label[] | void>): void;
  /** Context enrichment: extensions return sections for context injection */
  on(event: 'context_enrich', handler: (e: ContextEnrichEvent, ctx: ExtensionContextV6) => Promise<ContextEnrichResult | void>): void;
  /** Model routing: first result wins */
  on(event: 'route', handler: (e: RouteEvent, ctx: ExtensionContextV6) => Promise<RouteResult | void>): void;
  /** Input transformation: extensions can rewrite user input */
  on(event: 'input', handler: (e: InputEvent, ctx: ExtensionContextV6) => Promise<InputResult | void>): void;
  /** Tool call interception: fired before tool execution, can block */
  on(event: 'tool_call', handler: (e: ToolCallEvent, ctx: ExtensionContextV6) => Promise<ToolCallResult | void>): void;
  /** Tool result observation: fired after tool execution */
  on(event: 'tool_result', handler: (e: ToolResultEvent, ctx: ExtensionContextV6) => Promise<void>): void;

  // ── Lifecycle events ──

  on(event: 'session_start', handler: (e: undefined, ctx: ExtensionContextV6) => Promise<void>): void;
  on(event: 'session_end', handler: (e: undefined, ctx: ExtensionContextV6) => Promise<void>): void;
  on(event: 'session_compact', handler: (e: undefined, ctx: ExtensionContextV6) => Promise<void>): void;
  on(event: 'agent_start', handler: (e: undefined, ctx: ExtensionContextV6) => Promise<void>): void;
  on(event: 'agent_end', handler: (e: AgentEndEvent, ctx: ExtensionContextV6) => Promise<void>): void;
  on(event: 'turn_start', handler: (e: undefined, ctx: ExtensionContextV6) => Promise<void>): void;
  on(event: 'turn_end', handler: (e: undefined, ctx: ExtensionContextV6) => Promise<void>): void;

  // ── Catch-all for custom/Pi-specific events ──

  on(event: string, handler: (e: any, ctx: ExtensionContextV6) => Promise<any>): void;

  // ── Resource registration ──

  /** Register a tool that the agent can invoke */
  registerTool(tool: ToolDefinition): void;
  /** Register a command (slash command, etc.) */
  registerCommand(command: CommandDefinition): void;
  /** Register a skill for context enrichment and discovery */
  registerSkill(skill: Skill): void;
  /** Register an identity document */
  registerIdentity(identity: Identity): void;
  /** Contribute labels to the global vocabulary (for label matching) */
  contributeLabels(labels: string[]): void;

  /**
   * Contribute structured metadata about this extension.
   * Called at boot time (inside the extension factory function).
   * The core assembles these into the dot-ai:system section so the agent
   * always knows what backends and tools are available.
   *
   * @example
   * api.contributeMetadata({
   *   category: 'memory',
   *   backend: 'File-based',
   *   tools: ['memory_recall', 'memory_store'],
   * });
   */
  contributeMetadata(meta: import('./extension-types.js').ExtensionMetadata): void;

  // ── Inter-extension communication ──

  events: {
    on(event: string, handler: (...args: unknown[]) => void): void;
    off(event: string, handler: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
  };

  // ── Extension config ──

  /** Extension configuration (from extension-specific config files, env vars, etc.) */
  config: Record<string, unknown>;

  /** Workspace root directory (contains .ai/) */
  workspaceRoot: string;
}
