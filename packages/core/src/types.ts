/**
 * A label is a boolean tag matched against the prompt.
 * No scores — matched or not.
 */
export interface Label {
  name: string;
  source: string; // which provider/step produced this
}

export interface MemoryEntry {
  content: string;
  type: string; // "fact", "decision", "log", "pattern"
  source: string;
  date?: string;
  labels?: string[];
}

export interface Skill {
  name: string;
  description: string;
  labels: string[];
  triggers?: string[];      // "always", "auto", pattern strings
  path?: string;            // provider decides if this exists
  content?: string;         // lazy loaded
  dependsOn?: string[];
  requiresTools?: string[];
  enabled?: boolean;
}

export interface Identity {
  type: string;           // "agents", "soul", "user", "identity"
  content: string;
  source: string;         // provider name
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
}

export interface RoutingResult {
  model: string;
  reason: string;
  fallback?: string;
}

/**
 * The output of the enrich() call.
 * This is what adapters consume to inject into the agent.
 */
export interface EnrichedContext {
  prompt: string;
  labels: Label[];
  identities: Identity[];
  memories: MemoryEntry[];
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
 * Configuration from dot-ai.yml
 */
export interface DebugConfig {
  logPath?: string;
}

export interface DotAiConfig {
  memory?: ProviderConfig;
  skills?: ProviderConfig;
  identity?: ProviderConfig;
  routing?: ProviderConfig;
  tasks?: ProviderConfig;
  tools?: ProviderConfig;
  debug?: DebugConfig;
}

export interface ProviderConfig {
  use: string;   // "@dot-ai/file-memory", "@dot-ai/cockpit-memory", etc.
  with?: Record<string, unknown>; // provider-specific options
}
