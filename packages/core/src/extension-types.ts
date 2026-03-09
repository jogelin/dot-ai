import type { Label, RoutingResult, Skill, Identity } from './types.js';

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
// v7 Extension Types
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
   * 100 = identity, 95 = system, 80 = memory, 60 = skills, 50 = tasks, 40 = tools, 30 = routing.
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
  /**
   * Detail level — set by extensions to signal how much context is in this section.
   * - 'directive': high-relevance, actionable ("→ Use skill: name — description")
   * - 'overview':  medium-relevance, informational ("name: description")
   * - 'full':      full file content (legacy / explicit request)
   * Omit for sections where the concept doesn't apply (memory, identity, system).
   */
  detailLevel?: 'directive' | 'overview' | 'full';
  /** Match score that produced this section (for debugging / tie-breaking) */
  matchScore?: number;
}

// ── label_extract (chain-transform) ──────────────────────────────────────────

/** Event for label_extract -- handlers modify and return the labels array */
export interface LabelExtractEvent {
  /** The user's prompt text */
  prompt: string;
  /** Known label vocabulary (from registered resources) */
  vocabulary: string[];
  /** Current labels -- handler returns modified array */
  labels: Label[];
}

// ── context_enrich ───────────────────────────────────────────────────────────

/** Event for context_enrich */
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
 * Extensions register commands via `api.registerCommand()`.
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

// ── Tool Definition ──────────────────────────────────────────────────────────

/** Tool definition for extensions -- structurally compatible with Pi */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object describing tool parameters */
  parameters: Record<string, unknown>;
  /** Execute the tool. ctx is optional for backward compatibility. */
  execute(input: Record<string, unknown>, ctx?: ExtensionContext): Promise<{ content: string; details?: unknown; isError?: boolean }>;
  /** Injected into system prompt when tool is active */
  promptSnippet?: string;
  /** Guidelines for the LLM when using this tool */
  promptGuidelines?: string;
}

// ── Tool Events ──────────────────────────────────────────────────────────────

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
// Event Union
// ══════════════════════════════════════════════════════════════════════════════

/** Union of all normalized extension events (v7) */
export type ExtensionEvent =
  // Per-prompt pipeline
  | { type: 'label_extract'; data: LabelExtractEvent }
  | { type: 'context_enrich'; data: ContextEnrichEvent }
  | { type: 'route'; data: RouteEvent }
  | { type: 'input'; data: InputEvent }
  // Tool events
  | { type: 'tool_call'; data: ToolCallEvent }
  | { type: 'tool_result'; data: ToolResultEvent }
  // Agent loop
  | { type: 'agent_start' }
  | { type: 'agent_end'; data: AgentEndEvent }
  // Turn level
  | { type: 'turn_start' }
  | { type: 'turn_end' }
  // Session level
  | { type: 'session_start' }
  | { type: 'session_end' }
  | { type: 'session_compact' };

// ══════════════════════════════════════════════════════════════════════════════
// Loaded Extension
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Metadata an extension contributes at boot time via `api.contributeMetadata()`.
 * Used by the core to build the dot-ai:system section so the agent always knows
 * what backends and tools are available — without scanning every extension.
 */
export interface ExtensionMetadata {
  /** Category label (e.g. 'memory', 'skills', 'identity', 'routing') */
  category: string;
  /** Human-readable backend description (e.g. 'File-based', 'SQLite') */
  backend: string;
  /** Tool names this extension registers (shown in system section) */
  tools?: string[];
  /**
   * Arbitrary stats to surface in the system section.
   * Convention: numeric values → shown as "(N registered)", string values → shown as-is.
   */
  stats?: Record<string, number | string>;
}

/** A loaded extension with its handlers, tools, commands, skills, and identities */
export interface LoadedExtension {
  path: string;
  handlers: Map<string, Function[]>;
  tools: Map<string, ToolDefinition>;
  commands: Map<string, CommandDefinition>;
  skills: Map<string, Skill>;
  identities: Map<string, Identity>;
  labels: Set<string>;
  /** Metadata contributed by this extension at boot (via api.contributeMetadata()) */
  metadata?: ExtensionMetadata;
}

// ══════════════════════════════════════════════════════════════════════════════
// Diagnostics
// ══════════════════════════════════════════════════════════════════════════════

/** Extension diagnostics */
export interface ExtensionDiagnostic {
  path: string;
  handlerCounts: Record<string, number>;
  toolNames: string[];
  commandNames: string[];
  skillNames: string[];
  identityNames: string[];
}
