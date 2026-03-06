/**
 * A label is a boolean tag matched against the prompt.
 * No scores — matched or not.
 */
export interface Label {
  name: string;
  source: string; // which extension/step produced this
}

/**
 * A workspace node — a directory containing .ai/ context.
 * Root node is always included. Sub-nodes are discovered via scanDirs.
 */
export interface Node {
  name: string;       // "root", "pro", "cockpit"
  path: string;       // absolute path to the .ai/ directory
  root: boolean;      // is this the workspace root node?
}

export interface MemoryEntry {
  content: string;
  type: string; // "fact", "decision", "log", "pattern"
  source: string;
  date?: string;
  labels?: string[];
  node?: string;        // which node this came from
}

export interface Skill {
  name: string;
  description: string;
  labels: string[];
  triggers?: string[];      // "always", "auto", pattern strings
  path?: string;            // extension decides if this exists
  content?: string;         // lazy loaded
  dependsOn?: string[];
  requiresTools?: string[];
  enabled?: boolean;
  node?: string;          // which node this came from
}

export interface Identity {
  type: string;           // "agents", "soul", "user", "identity"
  content: string;
  source: string;         // extension name
  priority: number;       // for ordering in prompt
  node?: string;          // which context node (null = root)
}

export interface Task {
  id: string;
  text: string;
  status: string;
  priority?: string;
  project?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface Tool {
  name: string;
  description: string;
  labels: string[];
  config: Record<string, unknown>;
  source: string;
  node?: string;          // which node this came from
}

export interface RoutingResult {
  model: string;
  reason: string;
  fallback?: string;
}

/**
 * The output of the enrich pipeline.
 * This is what adapters consume to inject into the agent.
 */
export interface EnrichedContext {
  prompt: string;
  labels: Label[];
  identities: Identity[];
  memories: MemoryEntry[];
  memoryDescription?: string;
  recentTasks?: Task[];
  skills: Skill[];
  tools: Tool[];
  routing: RoutingResult;
}

/**
 * Filter for task queries
 */
export interface TaskFilter {
  status?: string;
  project?: string;
  tags?: string[];
}

/**
 * Configuration types
 */
export interface DebugConfig {
  logPath?: string;
}

export interface WorkspaceConfig {
  scanDirs?: string;    // comma-separated dirs to scan, default "projects"
}

export interface DotAiConfig {
  debug?: DebugConfig;
  workspace?: WorkspaceConfig;
  extensions?: ExtensionsConfig;
  prompts?: PromptsConfig;
}

/** Prompt template type */
export interface PromptTemplate {
  name: string;
  content: string;
  args?: string[];
  description?: string;
}

/** Extensions config section */
export interface ExtensionsConfig {
  paths?: string[];
  packages?: string[];
}

/** Prompts config section */
export interface PromptsConfig {
  use?: string;
  with?: Record<string, unknown>;
}

/**
 * Warning emitted when context exceeds the token budget.
 */
export interface BudgetWarning {
  budget: number;
  actual: number;
  actions: string[];
}
