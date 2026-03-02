import path from "node:path";
import type { TaskProvider, MemoryProvider } from "./index.js";
import { loadConfig } from "./config.js";
import type { WorkspaceConfig } from "./config.js";
import { FileTaskProvider } from "./providers/tasks.js";
import { FileMemoryProvider } from "./providers/memory.js";

/**
 * Registry of custom provider factories.
 *
 * Workspaces register their custom providers before calling createProviders().
 * Core only ships "file" as a built-in. Everything else is external.
 */
export type TaskProviderFactory = (config: {
  url?: string;
  apiKey?: string;
}) => TaskProvider;

const taskProviderRegistry = new Map<string, TaskProviderFactory>();

/**
 * Register a custom task provider type.
 *
 * Call this before boot() or createProviders() to make custom types
 * available in config.yaml.
 *
 * Example (in kiwi):
 *   registerTaskProvider("cockpit", (cfg) => new CockpitTaskProvider(cfg));
 */
export function registerTaskProvider(
  type: string,
  factory: TaskProviderFactory,
): void {
  taskProviderRegistry.set(type, factory);
}

/**
 * Create providers based on workspace config.
 *
 * Reads .ai/config.yaml and instantiates the appropriate
 * provider implementations. Falls back to file-based defaults.
 */
export async function createProviders(rootDir: string): Promise<Providers> {
  const config = await loadConfig(rootDir);
  const aiDir = path.join(rootDir, ".ai");

  return {
    tasks: createTaskProvider(config, aiDir),
    memory: new FileMemoryProvider(aiDir),
    config,
  };
}

export interface Providers {
  tasks: TaskProvider;
  memory: MemoryProvider;
  config: WorkspaceConfig;
}

function createTaskProvider(
  config: WorkspaceConfig,
  aiDir: string,
): TaskProvider {
  const taskConfig = config.providers?.tasks;

  if (!taskConfig || taskConfig.type === "file") {
    return new FileTaskProvider(aiDir);
  }

  // Look up custom provider in registry
  const factory = taskProviderRegistry.get(taskConfig.type);
  if (!factory) {
    throw new Error(
      `config.yaml: unknown task provider type "${taskConfig.type}". ` +
        `Register it with registerTaskProvider() before boot().`,
    );
  }

  return factory({ url: taskConfig.url, apiKey: taskConfig.apiKey });
}
