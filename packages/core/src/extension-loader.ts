import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ExtensionAPI } from './extension-api.js';
import type { LoadedExtension, ToolDefinition, CommandDefinition } from './extension-types.js';
import type { ExtensionsConfig, Skill, Identity } from './types.js';

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
 * Create an ExtensionAPI instance that collects registrations into a LoadedExtension.
 * Extensions communicate via events only — no provider access.
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
    skills: new Map(),
    identities: new Map(),
    labels: new Set(),
  };

  const api: ExtensionAPI = {
    on(event: string, handler: Function) {
      if (!extension.handlers.has(event)) {
        extension.handlers.set(event, []);
      }
      extension.handlers.get(event)!.push(handler);
    },
    registerTool(tool: ToolDefinition) {
      extension.tools.set(tool.name, tool);
    },
    registerCommand(command: CommandDefinition) {
      extension.commands.set(command.name, command);
    },
    registerSkill(skill: Skill) {
      extension.skills.set(skill.name, skill);
      // Skills contribute their labels and triggers to vocabulary
      for (const label of skill.labels) extension.labels.add(label);
      for (const trigger of skill.triggers ?? []) extension.labels.add(trigger);
    },
    registerIdentity(identity: Identity) {
      const key = `${identity.type}:${identity.node ?? 'root'}`;
      extension.identities.set(key, identity);
    },
    contributeLabels(labels: string[]) {
      for (const label of labels) extension.labels.add(label);
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
