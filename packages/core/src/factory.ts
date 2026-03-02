import path from "node:path";
import type { TaskProvider, MemoryProvider } from "./index.js";
import { loadConfig } from "./config.js";
import type { WorkspaceConfig } from "./config.js";
import { FileTaskProvider } from "./providers/tasks.js";
import { FileMemoryProvider } from "./providers/memory.js";
import { CockpitTaskProvider } from "./providers/cockpit-tasks.js";

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

  if (taskConfig?.type === "cockpit") {
    if (!taskConfig.url) {
      throw new Error(
        "config.yaml: providers.tasks.type=cockpit requires a 'url' field",
      );
    }
    return new CockpitTaskProvider({
      url: taskConfig.url,
      apiKey: taskConfig.apiKey,
    });
  }

  // Default: file-based
  return new FileTaskProvider(aiDir);
}
