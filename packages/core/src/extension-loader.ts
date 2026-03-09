import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ExtensionAPI } from './extension-api.js';
import type { LoadedExtension, ToolDefinition, CommandDefinition, ExtensionMetadata } from './extension-types.js';
import type { ExtensionsConfig, Skill, Identity } from './types.js';

function isExtensionFile(name: string): boolean {
  return name.endsWith('.ts') || name.endsWith('.js');
}

/**
 * Resolve extension entry points from a directory.
 *
 * Checks for:
 * 1. package.json with "dot-ai.extensions" field -> returns declared paths
 * 2. index.ts or index.js -> returns the index file
 *
 * Returns resolved paths or null if no entry points found.
 */
async function resolveExtensionEntries(dir: string): Promise<string[] | null> {
  // Check for package.json with "dot-ai" field first
  try {
    const pkgPath = join(dir, 'package.json');
    const pkgRaw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    const dotAi = pkg['dot-ai'] as { extensions?: string[] } | undefined;
    if (dotAi?.extensions && Array.isArray(dotAi.extensions)) {
      const entries: string[] = [];
      for (const ext of dotAi.extensions) {
        const resolvedPath = resolve(dir, ext);
        try {
          await stat(resolvedPath);
          entries.push(resolvedPath);
        } catch { /* entry doesn't exist */ }
      }
      if (entries.length > 0) return entries;
    }
  } catch { /* no package.json or invalid */ }

  // Check for index.ts or index.js
  for (const indexName of ['index.ts', 'index.js']) {
    const indexPath = join(dir, indexName);
    try {
      await stat(indexPath);
      return [indexPath];
    } catch { /* not found */ }
  }

  return null;
}

/**
 * Scan a directory for extensions.
 *
 * Discovery rules:
 * 1. Direct files: `dir/*.ts` or `*.js` -> load
 * 2. Subdirectory with package.json: `dir/sub/package.json` with "dot-ai" field -> load what it declares
 * 3. Subdirectory with index: `dir/sub/index.ts` or `index.js` -> load
 *
 * No recursion beyond one level. Complex packages must use package.json manifest.
 */
async function discoverExtensionsInDir(dir: string): Promise<string[]> {
  const discovered: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(dir, entry.name);

      // 1. Direct files: *.ts or *.js
      if (entry.isFile() && isExtensionFile(entry.name)) {
        discovered.push(entryPath);
        continue;
      }

      // 2 & 3. Subdirectories: package.json or index file
      if (entry.isDirectory()) {
        const resolved = await resolveExtensionEntries(entryPath);
        if (resolved) {
          discovered.push(...resolved);
        }
      }
    }
  } catch { /* directory doesn't exist — skip */ }

  return discovered;
}

/**
 * Resolve extensions from installed packages in .ai/packages/.
 *
 * Reads the package.json created by `npm --prefix .ai/packages/` and resolves
 * extension entry points from each installed package's "dot-ai.extensions" field.
 *
 * Returns both the resolved paths and the package names found, so the caller
 * can skip these packages when resolving from workspace node_modules.
 */
async function resolveInstalledPackages(workspaceRoot: string): Promise<{ paths: string[]; packageNames: string[] }> {
  const packagesDir = join(workspaceRoot, '.ai', 'packages');
  const pkgJsonPath = join(packagesDir, 'package.json');

  try {
    const raw = await readFile(pkgJsonPath, 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const deps = pkg.dependencies as Record<string, string> | undefined;
    if (!deps) return { paths: [], packageNames: [] };

    const paths: string[] = [];
    const packageNames = Object.keys(deps);
    for (const name of packageNames) {
      const pkgDir = join(packagesDir, 'node_modules', name);
      const entries = await resolveExtensionEntries(pkgDir);
      if (entries) {
        paths.push(...entries);
      }
    }
    return { paths, packageNames };
  } catch {
    return { paths: [], packageNames: [] };
  }
}

/**
 * Discover extension file paths from all sources.
 *
 * Sources (in order):
 * 1. Auto-discovery: .ai/extensions/ (project-local)
 * 2. Auto-discovery: ~/.ai/extensions/ (global)
 * 3. Installed packages: .ai/packages/node_modules/ (installed via dot-ai install)
 * 4. Configured paths: settings.json "extensions" array (explicit paths/dirs)
 * 5. Configured packages: settings.json "packages" array (npm package names resolved from workspace node_modules)
 *
 * Deduplication: Step 3 records which package names were already loaded from .ai/packages/.
 * Step 5 skips any package already loaded in step 3 to avoid duplicate extension loading
 * when the same package exists in both .ai/packages/ and the workspace's node_modules/.
 */
export async function discoverExtensions(
  workspaceRoot: string,
  config?: ExtensionsConfig,
): Promise<string[]> {
  const seen = new Set<string>();
  const allPaths: string[] = [];
  // Track package names loaded from .ai/packages/ to avoid duplicates in step 5
  const loadedPackageNames = new Set<string>();

  const addPaths = (paths: string[]) => {
    for (const p of paths) {
      const resolved = resolve(p);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        allPaths.push(resolved);
      }
    }
  };

  // 1. Project-local extensions: .ai/extensions/
  addPaths(await discoverExtensionsInDir(join(workspaceRoot, '.ai', 'extensions')));

  // 2. Global extensions: ~/.ai/extensions/
  addPaths(await discoverExtensionsInDir(join(homedir(), '.ai', 'extensions')));

  // 3. Installed packages: .ai/packages/node_modules/
  const { paths: installedPaths, packageNames } = await resolveInstalledPackages(workspaceRoot);
  addPaths(installedPaths);
  for (const name of packageNames) {
    loadedPackageNames.add(name);
  }

  // 4. Explicitly configured paths from settings.json "extensions" array
  if (config?.paths) {
    for (const p of config.paths) {
      const resolved = resolve(workspaceRoot, p);
      try {
        const s = await stat(resolved);
        if (s.isDirectory()) {
          // Check for package.json or index file first
          const entries = await resolveExtensionEntries(resolved);
          if (entries) {
            addPaths(entries);
          } else {
            // Discover individual files in directory
            addPaths(await discoverExtensionsInDir(resolved));
          }
        } else if (s.isFile()) {
          addPaths([resolved]);
        }
      } catch {
        // Path doesn't exist — add anyway (will fail at load time with clear error)
        addPaths([resolved]);
      }
    }
  }

  // 5. Configured npm packages from settings.json "packages" array
  // These are resolved from the workspace's own node_modules.
  // Skip packages already loaded from .ai/packages/ (step 3) to avoid duplicates.
  if (config?.packages) {
    for (const pkg of config.packages) {
      if (loadedPackageNames.has(pkg)) continue;
      try {
        const { createRequire } = await import('node:module');
        const require = createRequire(join(workspaceRoot, 'package.json'));
        const pkgJsonPath = require.resolve(`${pkg}/package.json`);
        const pkgDir = join(pkgJsonPath, '..');
        const entries = await resolveExtensionEntries(pkgDir);
        if (entries) {
          addPaths(entries);
        }
      } catch { /* package not found */ }
    }
  }

  return allPaths;
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
    contributeMetadata(meta: ExtensionMetadata) {
      extension.metadata = meta;
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
