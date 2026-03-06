import type { Label, RoutingResult } from './types.js';

// ══════════════════════════════════════════════════════════════════════════════
// Extension Context
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Base context passed to every event handler (second argument).
 * Adapters extend this with agent-specific state (providers, session control, etc.).
 * Mirrors Pi's `ctx` pattern: handler(event, ctx).
 */
export interface ExtensionContext {
  /** Current workspace root */
  workspaceRoot: string;
  /** Inter-extension event bus */
  events: {
    on(event: string, handler: (...args: unknown[]) => void): void;
    off(event: string, handler: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// v6 Unified Extension Types
// ══════════════════════════════════════════════════════════════════════════════

// ── Section (core output unit for context_enrich) ────────────────────────────

/**
 * A section is the atomic output unit of `context_enrich`.
 * Extensions return sections; the formatter assembles them by priority.
 */
export interface Section {
  /** Unique identifier for this section (optional — anonymous sections are allowed) */
  id?: string;
  /** Section heading */
  title: string;
  /** Markdown content */
  content: string;
  /**
   * Priority determines ordering and trim precedence.
   * 100 = identity, 80 = memory, 60 = skills, 50 = tasks, 40 = tools, 30 = routing.
   */
  priority: number;
  /** Which extension produced this section */
  source: string;
  /**
   * How this section should be handled when the token budget is exceeded.
   * - 'never': never trim (identity, critical context)
   * - 'truncate': shorten content but keep section
   * - 'drop': remove entirely (default)
   */
  trimStrategy?: 'never' | 'truncate' | 'drop';
}

// ── resources_discover ───────────────────────────────────────────────────────

/** A single resource entry discovered by an extension */
export interface ResourceEntry {
  /** Resource type: 'skill', 'identity', 'tool', 'prompt', etc. */
  type: string;
  /** Path to the resource (absolute or relative to workspace) */
  path: string;
  /** Labels for this specific resource */
  labels?: string[];
  /** Provider-specific metadata */
  metadata?: Record<string, unknown>;
}

/** Result returned by resources_discover handlers */
export interface ResourcesDiscoverResult {
  /** Labels contributed to the global vocabulary */
  labels?: string[];
  /** Discovered resources (paths + metadata) */
  resources?: ResourceEntry[];
}

// ── label_extract (chain-transform) ──────────────────────────────────────────

/** Event for label_extract -- handlers modify and return the labels array */
export interface LabelExtractEvent {
  /** The user's prompt text */
  prompt: string;
  /** Known label vocabulary (from resources_discover) */
  vocabulary: string[];
  /** Current labels -- handler returns modified array */
  labels: Label[];
}

// ── context_enrich ───────────────────────────────────────────────────────────

/** Event for context_enrich -- replaces context_inject in v6 */
export interface ContextEnrichEvent {
  /** The user's prompt text */
  prompt: string;
  /** Matched labels for this turn */
  labels: Label[];
}

/** Result from context_enrich handlers */
export interface ContextEnrichResult {
  /** Sections to include in the formatted context */
  sections?: Section[];
  /** System prompt override (for Pi-like adapters that support it) */
  systemPrompt?: string;
}

/** Aggregated result from fireCollectSections */
export interface CollectedSections {
  sections: Section[];
  systemPrompt: string;
}

// ── route ────────────────────────────────────────────────────────────────────

/** Event for model routing */
export interface RouteEvent {
  /** Matched labels for this turn */
  labels: Label[];
}

/** Result from route handlers — alias for RoutingResult from types.ts */
export type RouteResult = RoutingResult;

// ── input ────────────────────────────────────────────────────────────────────

/** Event for input interception (Pi adapter) */
export interface InputEvent {
  /** Raw user input */
  input: string;
}

/** Result from input handlers */
export interface InputResult {
  /** Transformed input (if modified) */
  input?: string;
  /** If true, input was consumed and should not be forwarded */
  consumed?: boolean;
}

// ── Commands ─────────────────────────────────────────────────────────────────

/** A parameter for a command definition */
export interface CommandParameter {
  /** Parameter name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Whether this parameter is required */
  required?: boolean;
}

/** Result returned by command execution */
export interface CommandResult {
  /** Output text to display */
  output?: string;
}

/**
 * A command definition -- aligned with Pi's /command pattern.
 * Extensions register commands via `exports.commands`.
 */
export interface CommandDefinition {
  /** Command name (without leading slash) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Parameter definitions */
  parameters?: CommandParameter[];
  /** Execute the command */
  execute(args: Record<string, string>, ctx: ExtensionContext): Promise<CommandResult | void>;
  /** Tab-completion provider */
  completions?(prefix: string): string[] | Promise<string[]>;
}

// ── Tool Definition (v6 -- with ctx) ─────────────────────────────────────────

/** Tool definition for extensions -- structurally compatible with Pi */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object describing tool parameters */
  parameters: Record<string, unknown>;
  /** Execute the tool. ctx is optional for backward compatibility with v5 extensions. */
  execute(input: Record<string, unknown>, ctx?: ExtensionContext): Promise<{ content: string; details?: unknown; isError?: boolean }>;
  /** Injected into system prompt when tool is active */
  promptSnippet?: string;
  /** Guidelines for the LLM when using this tool */
  promptGuidelines?: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Legacy v5 Event Types (deprecated -- will be removed in v7)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @deprecated Use ContextEnrichEvent + ContextEnrichResult instead.
 * Tier 1 (universal) -- context injection event.
 */
export interface ContextInjectEvent {
  prompt: string;
  labels: Label[];
  usage?: { inputTokens: number; contextWindow: number };
}

/**
 * @deprecated Use ContextEnrichResult instead.
 */
export interface ContextInjectResult {
  inject?: string;
}

/**
 * @deprecated Use ContextEnrichEvent with context_modify support.
 * Tier 2 (rich agents only) -- message-level context modification.
 */
export interface ContextModifyEvent {
  messages: Message[];
  usage?: { inputTokens: number; contextWindow: number };
}

/**
 * @deprecated Use ContextEnrichResult instead.
 */
export interface ContextModifyResult {
  messages?: Message[];
  inject?: string; // fallback for adapters that don't support message modification
}

/** Message type for context_modify */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Tool call event -- fired before tool execution */
export interface ToolCallEvent {
  tool: string;
  input: Record<string, unknown>;
}

export interface ToolCallResult {
  decision?: 'allow' | 'block';
  reason?: string;
}

/** Tool result event -- fired after tool execution */
export interface ToolResultEvent {
  tool: string;
  result: { content: string };
  isError: boolean;
}

/** Agent end event */
export interface AgentEndEvent {
  response: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Event Union & Metadata
// ══════════════════════════════════════════════════════════════════════════════

/** Union of all extension events (v5 legacy + v6) */
export type ExtensionEvent =
  // v6 events
  | { type: 'resources_discover' }
  | { type: 'label_extract'; data: LabelExtractEvent }
  | { type: 'context_enrich'; data: ContextEnrichEvent }
  | { type: 'route'; data: RouteEvent }
  | { type: 'input'; data: InputEvent }
  // Shared events (both v5 and v6)
  | { type: 'context_modify'; data: ContextModifyEvent }
  | { type: 'tool_call'; data: ToolCallEvent }
  | { type: 'tool_result'; data: ToolResultEvent }
  | { type: 'agent_start' }
  | { type: 'agent_end'; data: AgentEndEvent }
  | { type: 'session_start' }
  | { type: 'session_end' }
  | { type: 'turn_start' }
  | { type: 'turn_end' }
  | { type: 'message_start' }
  | { type: 'message_update' }
  | { type: 'message_end' }
  | { type: 'model_select' }
  | { type: 'user_bash' }
  | { type: 'session_before_switch' }
  | { type: 'session_switch' }
  | { type: 'session_before_compact' }
  | { type: 'session_compact' }
  // v5 legacy (deprecated)
  | { type: 'context_inject'; data: ContextInjectEvent };

/** Extension tier metadata */
export type ExtensionTier = 'universal' | 'rich';

/** Event name to tier mapping */
export const EVENT_TIERS: Record<string, ExtensionTier> = {
  // v6 events (all universal)
  resources_discover: 'universal',
  label_extract: 'universal',
  context_enrich: 'universal',
  route: 'universal',
  input: 'universal',
  // Shared events
  context_modify: 'rich',
  tool_call: 'universal',
  tool_result: 'rich',
  agent_start: 'rich',
  agent_end: 'universal',
  session_start: 'universal',
  session_end: 'universal',
  turn_start: 'rich',
  turn_end: 'rich',
  message_start: 'rich',
  message_update: 'rich',
  message_end: 'rich',
  model_select: 'rich',
  user_bash: 'rich',
  session_before_switch: 'rich',
  session_switch: 'rich',
  session_before_compact: 'rich',
  session_compact: 'rich',
  // v5 legacy (deprecated)
  context_inject: 'universal',
};

/** All valid event names */
export type ExtensionEventName = keyof typeof EVENT_TIERS;

// ══════════════════════════════════════════════════════════════════════════════
// Loaded Extension & Adapter Capabilities
// ══════════════════════════════════════════════════════════════════════════════

/** A loaded extension with its handlers, tools, and commands */
export interface LoadedExtension {
  path: string;
  handlers: Map<string, Function[]>;
  tools: Map<string, ToolDefinition>;
  /** Registered commands (v6) */
  commands: Map<string, CommandDefinition>;
  tiers: Set<ExtensionTier>;
}

/**
 * Adapter capability matrix -- which events each adapter supports.
 * v6 events listed first; legacy events marked with comments.
 */
export const ADAPTER_CAPABILITIES: Record<string, Set<string>> = {
  pi: new Set([
    'session_start', 'session_end',
    'resources_discover',
    'label_extract', 'context_enrich', 'context_modify', 'route',
    'input',
    'tool_call', 'tool_result',
    'agent_start', 'agent_end',
    'turn_start', 'turn_end',
    'message_start', 'message_update', 'message_end',
    'session_before_switch', 'session_switch',
    'session_before_compact', 'session_compact',
    'model_select', 'user_bash',
    // Legacy (deprecated)
    'context_inject',
  ]),
  'claude-code': new Set([
    'session_start', 'session_end',
    'resources_discover',
    'label_extract', 'context_enrich', 'route',
    'tool_call', 'tool_result',
    'agent_end',
    // Legacy (deprecated)
    'context_inject',
  ]),
  openclaw: new Set([
    'session_start', 'session_end',
    'resources_discover',
    'label_extract', 'context_enrich', 'route',
    'agent_end',
    // Legacy (deprecated)
    'context_inject',
  ]),
  sync: new Set([
    'resources_discover',
    'context_enrich', 'route',
    // Legacy (deprecated)
    'context_inject',
  ]),
};

/**
 * Tool integration strategy per adapter.
 * - 'native': adapter can register tools natively (Pi, OpenClaw)
 * - 'cli': tools are exposed as CLI commands (Claude Code)
 * - 'text': tools are described in the system prompt only (Cursor, Copilot)
 */
export const TOOL_STRATEGY: Record<string, 'native' | 'cli' | 'text'> = {
  pi: 'native',
  openclaw: 'native',
  'claude-code': 'cli',
  sync: 'text',
  cursor: 'text',
  copilot: 'text',
};

// ══════════════════════════════════════════════════════════════════════════════
// Diagnostics
// ══════════════════════════════════════════════════════════════════════════════

/** Extension diagnostics */
export interface ExtensionDiagnostic {
  path: string;
  handlerCounts: Record<string, number>;
  toolNames: string[];
  /** Command names registered by this extension */
  commandNames: string[];
  tiers: ExtensionTier[];
}
