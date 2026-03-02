/**
 * @dot-ai/core — Provider interfaces and workspace utilities
 *
 * This is the framework-agnostic core of dot-ai.
 * Adapters (OpenClaw, Claude Code) build on these interfaces.
 */

// ── Provider interfaces ──────────────────────────────────────────────────────

export interface MemoryProvider {
  readDaily(date: string): Promise<string | null>;
  writeDaily(date: string, content: string): Promise<void>;
  search(query: string): Promise<string[]>;
}

export interface TaskProvider {
  list(filter?: { status?: string; project?: string }): Promise<Task[]>;
  get(id: string): Promise<Task | null>;
  create(task: Omit<Task, 'id'>): Promise<Task>;
  update(id: string, patch: Partial<Task>): Promise<Task>;
}

export interface Task {
  id: string;
  text: string;
  status: string;
  priority?: string;
  project?: string;
  tags?: string[];
}

export interface ModelRouter {
  resolveAlias(alias: string): string;
  selectForTask(taskType: string): string;
}

export interface SkillRegistry {
  discover(rootDir: string): Promise<SkillMeta[]>;
  get(name: string): Promise<string | null>;
  validate(skillPath: string): Promise<ValidationResult>;
}

export interface ToolRegistry {
  discover(rootDir: string): Promise<ToolMeta[]>;
  get(name: string): Promise<string | null>;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface SkillMeta {
  name: string;
  description: string;
  triggers: string[];
  path: string;
}

export interface ToolMeta {
  name: string;
  description: string;
  path: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface WorkspaceInfo {
  rootDir: string;
  projects: ProjectMeta[];
  skills: SkillMeta[];
}

export interface ProjectMeta {
  name: string;
  description: string;
  tags: string[];
  path: string;
}

// ── Re-exports ───────────────────────────────────────────────────────────────

export { FileMemoryProvider } from "./providers/memory.js";
export { FileTaskProvider } from "./providers/tasks.js";
export { FileSkillRegistry } from "./providers/skills.js";
export { DefaultModelRouter } from "./providers/router.js";
export { discoverWorkspace } from "./discovery.js";
export { boot } from "./boot.js";
export type { BootResult } from "./boot.js";
export { validateWorkspace } from "./workspace.js";
export { loadConfig } from "./config.js";
export type { WorkspaceConfig, TaskProviderConfig } from "./config.js";
export { createProviders, registerTaskProvider } from "./factory.js";
export type { Providers, TaskProviderFactory } from "./factory.js";
