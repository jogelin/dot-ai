import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Logger } from './logger.js';
import type { DotAiExtensionAPI, ExtensionAPI } from './extension-api.js';
import type { LoadedExtension, ToolDefinition, CommandDefinition, ExtensionTier } from './extension-types.js';
import { EVENT_TIERS } from './extension-types.js';
import type { ExtensionsConfig, MemoryEntry, Label, Task, TaskFilter } from './types.js';
import type { Providers } from './engine.js';

/**
 * Discover extension file paths from configured locations.
 */
export async function discoverExtensions(
  workspaceRoot: string,
  config?: ExtensionsConfig,
): Promise<string[]> {
  const paths = new Set<string>();

  // Default discovery paths
  const searchDirs = [
    join(workspaceRoot, '.ai', 'extensions'),
    join(homedir(), '.ai', 'extensions'),
    ...(config?.paths ?? []).map(p => resolve(workspaceRoot, p)),
  ];

  for (const dir of searchDirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
          paths.add(fullPath);
        } else if (entry.isDirectory()) {
          // Check for index.ts or index.js
          for (const indexName of ['index.ts', 'index.js']) {
            const indexPath = join(fullPath, indexName);
            try {
              await stat(indexPath);
              paths.add(indexPath);
              break;
            } catch { /* not found */ }
          }
          // Check for package.json with dot-ai field
          try {
            const pkgPath = join(fullPath, 'package.json');
            const pkgRaw = await readFile(pkgPath, 'utf-8');
            const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
            const dotAi = pkg['dot-ai'] as { extensions?: string[] } | undefined;
            if (dotAi?.extensions && Array.isArray(dotAi.extensions)) {
              for (const ext of dotAi.extensions) {
                paths.add(resolve(fullPath, ext));
              }
            }
          } catch { /* no package.json or no dot-ai field */ }
        }
      }
    } catch { /* directory doesn't exist — skip */ }
  }

  // Also resolve npm packages from config
  if (config?.packages) {
    for (const pkg of config.packages) {
      try {
        const { createRequire } = await import('node:module');
        const require = createRequire(join(workspaceRoot, 'package.json'));
        const pkgJsonPath = require.resolve(`${pkg}/package.json`);
        const pkgRaw = await readFile(pkgJsonPath, 'utf-8');
        const pkgJson = JSON.parse(pkgRaw) as Record<string, unknown>;
        const dotAi = pkgJson['dot-ai'] as { extensions?: string[] } | undefined;
        if (dotAi?.extensions && Array.isArray(dotAi.extensions)) {
          const pkgDir = join(pkgJsonPath, '..');
          for (const ext of dotAi.extensions) {
            paths.add(resolve(pkgDir, ext));
          }
        }
      } catch { /* package not found */ }
    }
  }

  return Array.from(paths);
}

/**
 * Create a DotAiExtensionAPI instance that collects registrations into a LoadedExtension.
 */
function createCollectorAPI(
  extensionPath: string,
  providers?: Providers,
  eventBus?: { on: (event: string, handler: (...args: unknown[]) => void) => void; emit: (event: string, ...args: unknown[]) => void },
): { api: DotAiExtensionAPI; extension: LoadedExtension } {
  const extension: LoadedExtension = {
    path: extensionPath,
    handlers: new Map(),
    tools: new Map(),
    commands: new Map(),
    tiers: new Set(),
  };

  const api: DotAiExtensionAPI = {
    on(event: string, handler: Function) {
      if (!extension.handlers.has(event)) {
        extension.handlers.set(event, []);
      }
      extension.handlers.get(event)!.push(handler);

      // Track tier
      const tier: ExtensionTier | undefined = EVENT_TIERS[event];
      if (tier) {
        extension.tiers.add(tier);
      }
    },
    registerTool(tool: ToolDefinition) {
      extension.tools.set(tool.name, tool);
    },
    registerCommand(command: CommandDefinition) {
      extension.commands.set(command.name, command);
    },
    providers: {
      memory: providers?.memory ? {
        search: (query: string, labels?: string[]) => providers.memory!.search(query, labels),
        store: (entry: Omit<MemoryEntry, 'source'>) => providers.memory!.store(entry),
      } : undefined,
      skills: providers?.skills ? {
        match: (labels: Label[]) => providers.skills!.match(labels),
        load: (name: string) => providers.skills!.load(name),
      } : undefined,
      routing: providers?.routing ? {
        route: (labels: Label[]) => providers.routing!.route(labels),
      } : undefined,
      tasks: providers?.tasks ? {
        list: (filter?: TaskFilter) => providers.tasks!.list(filter),
        get: (id: string) => providers.tasks!.get(id),
        create: (task: Omit<Task, 'id'>) => providers.tasks!.create(task),
        update: (id: string, patch: Partial<Task>) => providers.tasks!.update(id, patch),
      } : undefined,
    },
    events: eventBus ?? {
      on: () => {},
      emit: () => {},
    },
  } as unknown as DotAiExtensionAPI;

  return { api, extension };
}

/**
 * Create a v6 ExtensionAPI instance that collects registrations into a LoadedExtension.
 * Does NOT expose providers — extensions communicate via events only.
 */
export function createV6CollectorAPI(
  extensionPath: string,
  config: Record<string, unknown>,
  eventBus?: { on: (event: string, handler: (...args: unknown[]) => void) => void; emit: (event: string, ...args: unknown[]) => void },
  workspaceRoot?: string,
): { api: ExtensionAPI; extension: LoadedExtension } {
  const extension: LoadedExtension = {
    path: extensionPath,
    handlers: new Map(),
    tools: new Map(),
    commands: new Map(),
    tiers: new Set(),
  };

  const api: ExtensionAPI = {
    on(event: string, handler: Function) {
      if (!extension.handlers.has(event)) {
        extension.handlers.set(event, []);
      }
      extension.handlers.get(event)!.push(handler);

      const tier: ExtensionTier | undefined = EVENT_TIERS[event];
      if (tier) {
        extension.tiers.add(tier);
      }
    },
    registerTool(tool: ToolDefinition) {
      extension.tools.set(tool.name, tool);
    },
    registerCommand(command: CommandDefinition) {
      extension.commands.set(command.name, command);
    },
    events: eventBus ?? {
      on: () => {},
      emit: () => {},
    },
    config,
    workspaceRoot: workspaceRoot ?? process.cwd(),
  } as unknown as ExtensionAPI;

  return { api, extension };
}

/**
 * Load extensions from discovered paths using jiti.
 */
export async function loadExtensions(
  extensionPaths: string[],
  providers?: Providers,
  eventBus?: { on: (event: string, handler: (...args: unknown[]) => void) => void; emit: (event: string, ...args: unknown[]) => void },
  logger?: Logger,
): Promise<LoadedExtension[]> {
  if (extensionPaths.length === 0) return [];

  let jitiImport: ((id: string) => unknown) | undefined;
  try {
    const { createJiti } = await import('jiti');
    jitiImport = createJiti(import.meta.url, { interopDefault: true });
  } catch {
    logger?.log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      phase: 'boot',
      event: 'jiti_not_available',
      data: { message: 'jiti not installed, falling back to dynamic import' },
    });
  }

  const loaded: LoadedExtension[] = [];

  for (const extPath of extensionPaths) {
    try {
      let mod: Record<string, unknown>;
      if (jitiImport) {
        mod = jitiImport(extPath) as Record<string, unknown>;
      } else {
        mod = await import(extPath) as Record<string, unknown>;
      }

      const factory = (typeof mod.default === 'function' ? mod.default : mod) as
        ((api: DotAiExtensionAPI) => void | Promise<void>) | undefined;

      if (typeof factory !== 'function') {
        logger?.log({
          timestamp: new Date().toISOString(),
          level: 'warn',
          phase: 'boot',
          event: 'extension_no_factory',
          data: { path: extPath },
        });
        continue;
      }

      const { api, extension } = createCollectorAPI(extPath, providers, eventBus);
      await factory(api);
      loaded.push(extension);

      logger?.log({
        timestamp: new Date().toISOString(),
        level: 'info',
        phase: 'boot',
        event: 'extension_loaded',
        data: {
          path: extPath,
          handlers: Object.fromEntries(
            Array.from(extension.handlers.entries()).map(([k, v]) => [k, v.length]),
          ),
          tools: Array.from(extension.tools.keys()),
          tiers: Array.from(extension.tiers),
        },
      });
    } catch (err) {
      logger?.log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        phase: 'boot',
        event: 'extension_load_error',
        data: {
          path: extPath,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  return loaded;
}
