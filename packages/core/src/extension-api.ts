import type {
  ContextInjectEvent, ContextInjectResult,
  ContextModifyEvent, ContextModifyResult,
  ToolCallEvent, ToolCallResult,
  ToolResultEvent,
  AgentEndEvent,
  ToolDefinition,
  ExtensionContext,
  // v6 types
  ResourcesDiscoverResult,
  LabelExtractEvent,
  ContextEnrichEvent, ContextEnrichResult,
  RouteEvent, RouteResult,
  InputEvent, InputResult,
  CommandDefinition,
} from './extension-types.js';
import type { MemoryEntry, Skill, Label, RoutingResult, Task, TaskFilter } from './types.js';

// ══════════════════════════════════════════════════════════════════════════════
// v6 Extension API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * v6 Extension Context — passed as second argument to every event handler.
 * Extends the base ExtensionContext with labels and optional agent capabilities.
 * No providers property — extensions communicate via events.
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
 * v6 Extension API — passed to extension factory functions.
 * Pi-compatible: same on(event) + registerTool() + registerCommand() pattern.
 * No providers property — extensions access data via events.
 */
export interface ExtensionAPI {
  // ── Event subscription ──

  /** Resource discovery: extensions declare resources and contribute labels */
  on(event: 'resources_discover', handler: (e: undefined, ctx: ExtensionContextV6) => Promise<ResourcesDiscoverResult | void>): void;
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
  on(event: 'agent_start', handler: (e: undefined, ctx: ExtensionContextV6) => Promise<void>): void;
  on(event: 'agent_end', handler: (e: AgentEndEvent, ctx: ExtensionContextV6) => Promise<void>): void;
  on(event: 'turn_start', handler: (e: undefined, ctx: ExtensionContextV6) => Promise<void>): void;
  on(event: 'turn_end', handler: (e: undefined, ctx: ExtensionContextV6) => Promise<void>): void;

  // ── Legacy events (deprecated, kept for v5 compatibility) ──

  /** @deprecated Use context_enrich instead */
  on(event: 'context_inject', handler: (e: ContextInjectEvent, ctx: ExtensionContextV6) => Promise<ContextInjectResult | void>): void;
  /** @deprecated Use context_enrich instead */
  on(event: 'context_modify', handler: (e: ContextModifyEvent, ctx: ExtensionContextV6) => Promise<ContextModifyResult | void>): void;

  // ── Catch-all for custom/Pi-specific events ──

  on(event: string, handler: (e: any, ctx: ExtensionContextV6) => Promise<any>): void;

  // ── Capability registration ──

  /** Register a tool that the agent can invoke */
  registerTool(tool: ToolDefinition): void;
  /** Register a command (slash command, etc.) */
  registerCommand(command: CommandDefinition): void;

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

// ══════════════════════════════════════════════════════════════════════════════
// Deprecated v5 API (kept for Phase 1 coexistence)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @deprecated Use ExtensionContextV6 instead. Will be removed in v7.
 */
export interface DotAiExtensionContext extends ExtensionContext {
  providers: {
    memory?: {
      search(query: string, labels?: string[]): Promise<MemoryEntry[]>;
      store(entry: Omit<MemoryEntry, 'source'>): Promise<void>;
    };
    skills?: {
      match(labels: Label[]): Promise<Skill[]>;
      load(name: string): Promise<string | null>;
    };
    routing?: {
      route(labels: Label[]): Promise<RoutingResult>;
    };
    tasks?: {
      list(filter?: TaskFilter): Promise<Task[]>;
      get(id: string): Promise<Task | null>;
      create(task: Omit<Task, 'id'>): Promise<Task>;
      update(id: string, patch: Partial<Task>): Promise<Task>;
    };
  };
}

/**
 * @deprecated Use ExtensionAPI instead. Will be removed in v7.
 */
export interface DotAiExtensionAPI {
  // Tier 1 Events (universal)
  on(event: 'context_inject', handler: (e: ContextInjectEvent, ctx: DotAiExtensionContext) => Promise<ContextInjectResult | void>): void;
  on(event: 'tool_call', handler: (e: ToolCallEvent, ctx: DotAiExtensionContext) => Promise<ToolCallResult | void>): void;
  on(event: 'agent_end', handler: (e: AgentEndEvent, ctx: DotAiExtensionContext) => Promise<void>): void;
  on(event: 'session_start', handler: (e: undefined, ctx: DotAiExtensionContext) => Promise<void>): void;
  on(event: 'session_end', handler: (e: undefined, ctx: DotAiExtensionContext) => Promise<void>): void;

  // Tier 2 Events (rich agents)
  on(event: 'context_modify', handler: (e: ContextModifyEvent, ctx: DotAiExtensionContext) => Promise<ContextModifyResult | void>): void;
  on(event: 'tool_result', handler: (e: ToolResultEvent, ctx: DotAiExtensionContext) => Promise<void>): void;
  on(event: 'turn_start', handler: (e: undefined, ctx: DotAiExtensionContext) => Promise<void>): void;
  on(event: 'turn_end', handler: (e: undefined, ctx: DotAiExtensionContext) => Promise<void>): void;

  // Tools
  registerTool(tool: ToolDefinition): void;

  // dot-ai Providers (also available via ctx.providers in handlers)
  providers: DotAiExtensionContext['providers'];

  // Inter-extension EventBus (also available via ctx.events in handlers)
  events: {
    on(event: string, handler: (...args: unknown[]) => void): void;
    off(event: string, handler: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
  };
}
