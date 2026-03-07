import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { DotAiConfig, ExtensionsConfig } from './types.js';

/**
 * Load settings.json (Pi-compatible format).
 *
 * Format:
 * {
 *   "packages": ["npm:@dot-ai/ext-cockpit@1.0.0"],
 *   "extensions": [".ai/extensions/custom.ts"],
 *   "debug": { "logPath": "..." },
 *   "workspace": { "scanDirs": "..." }
 * }
 */
async function loadSettingsJson(workspaceRoot: string): Promise<DotAiConfig | null> {
  const settingsPath = join(workspaceRoot, '.ai', 'settings.json');
  try {
    const raw = await readFile(settingsPath, 'utf-8');
    const json = JSON.parse(raw);
    return settingsJsonToConfig(json);
  } catch {
    return null;
  }
}

/**
 * Convert Pi-compatible settings.json to DotAiConfig.
 */
function settingsJsonToConfig(json: Record<string, unknown>): DotAiConfig {
  const config: DotAiConfig = {};

  // Extensions: string[] of local paths
  const extensions = json['extensions'];
  const packages = json['packages'];

  if ((extensions && Array.isArray(extensions)) || (packages && Array.isArray(packages))) {
    config.extensions = {};
    if (extensions && Array.isArray(extensions)) {
      config.extensions.paths = extensions.filter((e): e is string => typeof e === 'string');
    }
    if (packages && Array.isArray(packages)) {
      config.extensions.packages = packages.filter((p): p is string => typeof p === 'string');
    }
  }

  // Debug section
  if (json['debug'] && typeof json['debug'] === 'object') {
    const debug = json['debug'] as Record<string, unknown>;
    config.debug = {};
    if (typeof debug['logPath'] === 'string') config.debug.logPath = debug['logPath'];
  }

  // Workspace section
  if (json['workspace'] && typeof json['workspace'] === 'object') {
    const ws = json['workspace'] as Record<string, unknown>;
    config.workspace = {};
    if (typeof ws['scanDirs'] === 'string') config.workspace.scanDirs = ws['scanDirs'];
  }

  return config;
}

/**
 * Merge two configs: global (base) + project (override).
 * Arrays (paths, packages) are concatenated and deduplicated.
 * Scalar values from project take precedence.
 */
function mergeConfigs(global: DotAiConfig, project: DotAiConfig): DotAiConfig {
  const merged: DotAiConfig = { ...global, ...project };

  // Merge extensions arrays (global + project, deduplicated)
  if (global.extensions || project.extensions) {
    const globalExt = global.extensions ?? {};
    const projectExt = project.extensions ?? {};
    merged.extensions = {
      paths: dedup([...(globalExt.paths ?? []), ...(projectExt.paths ?? [])]),
      packages: dedup([...(globalExt.packages ?? []), ...(projectExt.packages ?? [])]),
    };
    // Clean up empty arrays
    if (merged.extensions.paths!.length === 0) delete merged.extensions.paths;
    if (merged.extensions.packages!.length === 0) delete merged.extensions.packages;
    if (!merged.extensions.paths && !merged.extensions.packages) delete merged.extensions;
  }

  // Project debug/workspace override global
  if (project.debug) merged.debug = project.debug;
  if (project.workspace) merged.workspace = project.workspace;

  return merged;
}

function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Load config from workspace root.
 *
 * Loads from two sources and merges them:
 * 1. Global: ~/.ai/settings.json (user-level defaults)
 * 2. Project: {workspaceRoot}/.ai/settings.json (project-level overrides)
 *
 * Arrays (packages, extensions) are merged. Scalar values from project win.
 */
export async function loadConfig(workspaceRoot: string): Promise<DotAiConfig> {
  const globalConfig = await loadSettingsJson(homedir()) ?? {};
  const projectConfig = await loadSettingsJson(workspaceRoot) ?? {};
  return mergeConfigs(globalConfig, projectConfig);
}

/**
 * Migrate dot-ai.yml to settings.json.
 * Reads the existing YAML config and writes a settings.json equivalent.
 * Returns the path of the written file, or null if no YAML config exists.
 */
export async function migrateConfig(workspaceRoot: string): Promise<string | null> {
  const ymlPath = join(workspaceRoot, '.ai', 'dot-ai.yml');
  let raw: string;
  try {
    raw = await readFile(ymlPath, 'utf-8');
  } catch {
    return null; // No YAML config to migrate
  }

  // Extract extensions section from YAML if present
  const config: DotAiConfig = {};
  const extensions = parseExtensionsFromYaml(raw);
  if (extensions) {
    config.extensions = extensions;
  }

  const settings = configToSettingsJson(config);
  const settingsPath = join(workspaceRoot, '.ai', 'settings.json');
  const { writeFile: wf } = await import('node:fs/promises');
  await wf(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  return settingsPath;
}

/**
 * Convert DotAiConfig to Pi-compatible settings.json format.
 */
function configToSettingsJson(config: DotAiConfig): Record<string, unknown> {
  const settings: Record<string, unknown> = {};

  if (config.extensions?.paths?.length) {
    settings['extensions'] = config.extensions.paths;
  }
  if (config.extensions?.packages?.length) {
    settings['packages'] = config.extensions.packages;
  }
  if (config.debug) settings['debug'] = config.debug;
  if (config.workspace) settings['workspace'] = config.workspace;

  return settings;
}

/**
 * Parse extensions section from legacy YAML config.
 */
function parseExtensionsFromYaml(raw: string): ExtensionsConfig | null {
  const extensions: ExtensionsConfig = {};
  const lines = raw.split('\n');
  let inExtensions = false;
  let currentKey: 'paths' | 'packages' | null = null;

  for (const line of lines) {
    if (line.match(/^extensions:$/)) {
      inExtensions = true;
      continue;
    }
    if (inExtensions && line.match(/^\w+:/) && !line.match(/^extensions:/)) {
      break;
    }
    if (!inExtensions) continue;

    const inlineArrayMatch = line.match(/^\s{2}(\w+):\s*\[(.+)\]$/);
    if (inlineArrayMatch) {
      const key = inlineArrayMatch[1] as 'paths' | 'packages';
      const items = inlineArrayMatch[2]
        .split(',')
        .map(s => stripQuotes(s.trim()))
        .filter(s => s.length > 0);
      extensions[key] = items;
      currentKey = null;
      continue;
    }

    const keyMatch = line.match(/^\s{2}(\w+):$/);
    if (keyMatch) {
      currentKey = keyMatch[1] as 'paths' | 'packages';
      extensions[currentKey] = [];
      continue;
    }

    const listItemMatch = line.match(/^\s{4}-\s*(.+)$/);
    if (listItemMatch && currentKey) {
      if (!extensions[currentKey]) extensions[currentKey] = [];
      extensions[currentKey]!.push(stripQuotes(listItemMatch[1].trim()));
    }
  }

  if (extensions.paths?.length || extensions.packages?.length) {
    return extensions;
  }
  return null;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
