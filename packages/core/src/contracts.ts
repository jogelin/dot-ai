import type {
  MemoryEntry,
  Skill,
  Identity,
  Tool,
  Task,
  TaskFilter,
  RoutingResult,
  Label,
} from './types.js';

/**
 * Memory provider — search and store memories.
 * Implementation decides WHERE and HOW (files, DB, API, etc.)
 */
export interface MemoryProvider {
  search(query: string, labels?: string[]): Promise<MemoryEntry[]>;
  store(entry: Omit<MemoryEntry, 'source'>): Promise<void>;
  describe(): string;
}

/**
 * Skill provider — discover and load skills.
 * Implementation decides WHERE skills come from (files, registry, API, etc.)
 */
export interface SkillProvider {
  list(): Promise<Skill[]>;
  match(labels: Label[]): Promise<Skill[]>;
  load(name: string): Promise<string | null>; // returns content
}

/**
 * Identity provider — load identity documents.
 * Implementation decides format and source.
 *
 * load() returns root identities (always loaded at boot).
 * match() is optional: lazily loads project-level identities based on matched labels.
 */
export interface IdentityProvider {
  load(): Promise<Identity[]>;
  match?(labels: Label[]): Promise<Identity[]>; // optional lazy-load for project identities
}

/**
 * Routing provider — decide which model to use.
 * Implementation decides the logic (rules, LLM, etc.)
 */
export interface RoutingProvider {
  route(labels: Label[], context?: Record<string, unknown>): Promise<RoutingResult>;
}

/**
 * Task provider — CRUD for tasks.
 * Implementation decides storage (files, Cockpit API, Jira, etc.)
 */
export interface TaskProvider {
  list(filter?: TaskFilter): Promise<Task[]>;
  get(id: string): Promise<Task | null>;
  create(task: Omit<Task, 'id'>): Promise<Task>;
  update(id: string, patch: Partial<Task>): Promise<Task>;
}

/**
 * Tool provider — discover and match tools.
 * Implementation decides source (MCP config, files, registry, etc.)
 */
export interface ToolProvider {
  list(): Promise<Tool[]>;
  match(labels: Label[]): Promise<Tool[]>;
  load(name: string): Promise<Tool | null>;
}

/**
 * Factory function type for creating providers from config.
 */
export type ProviderFactory<T> = (options: Record<string, unknown>) => T | Promise<T>;
