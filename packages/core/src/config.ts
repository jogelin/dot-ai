import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DotAiConfig, HooksConfig, ProviderConfig, ExtensionsConfig, PromptsConfig } from './types.js';
import { discoverNodes, parseScanDirs } from './nodes.js';

/**
 * Inject the workspace root into all provider sections of a DotAiConfig.
 * This ensures file-based providers resolve paths relative to the workspace.
 */
export function injectRoot(config: DotAiConfig, root: string): DotAiConfig {
  // Discover workspace nodes
  const globalScanDirs = parseScanDirs(config.workspace?.scanDirs ?? 'projects');
  const nodes = discoverNodes(root, globalScanDirs);

  const result: DotAiConfig = {};
  const providerKeys = ['memory', 'skills', 'identity', 'routing', 'tasks', 'tools'] as const;
  for (const key of providerKeys) {
    const section = config[key];
    if (section && typeof section === 'object') {
      result[key] = {
        ...section,
        with: { root, nodes, ...(section.with ?? {}) },
      };
    }
  }
  // Preserve non-provider sections
  if (config.debug) {
    result.debug = config.debug;
  }
  if (config.workspace) {
    result.workspace = config.workspace;
  }
  if (config.extensions) {
    result.extensions = config.extensions;
  }
  if (config.prompts) {
    result.prompts = config.prompts;
  }
  return result;
}

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
 * Load and parse dot-ai.yml from a workspace root.
 * Returns the config with defaults applied.
 *
 * Uses a minimal YAML parser (key: value pairs + nested objects).
 * No dependency on yaml package.
 */
export async function loadConfig(workspaceRoot: string): Promise<DotAiConfig> {
  // Try settings.json first (v6 format)
  const settingsConfig = await loadSettingsJson(workspaceRoot);
  if (settingsConfig) return settingsConfig;

  // Fall back to dot-ai.yml (legacy format)
  const configPath = join(workspaceRoot, '.ai', 'dot-ai.yml');
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch {
    return {};
  }
  return parseYaml(raw);
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

  const config = parseYaml(raw);
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
 * Resolve a config — pass-through only.
 * If a provider is NOT configured, it returns undefined for that section.
 * The host agent handles unconfigured features with its own mechanisms.
 */
export interface ResolvedConfig {
  memory?: ProviderConfig;
  skills?: ProviderConfig;
  identity?: ProviderConfig;
  routing?: ProviderConfig;
  tasks?: ProviderConfig;
  tools?: ProviderConfig;
  debug?: import('./types.js').DebugConfig;
}

export function resolveConfig(config: DotAiConfig): ResolvedConfig {
  return {
    memory: config.memory,
    skills: config.skills,
    identity: config.identity,
    routing: config.routing,
    tasks: config.tasks,
    tools: config.tools,
    debug: config.debug,
  };
}

// ── Minimal YAML parser ─────────────────────────────────────────────────────

interface YamlNode {
  [key: string]: string | YamlNode;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseYaml(raw: string): DotAiConfig {
  const lines = raw.split('\n');
  const result: YamlNode = {};
  let currentSection: string | null = null;

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith('#') || line.trim() === '') continue;

    // Top-level key (no indent)
    const topMatch = line.match(/^(\w+):$/);
    if (topMatch) {
      currentSection = topMatch[1];
      result[currentSection] = {};
      continue;
    }

    // Nested key: value (2-space indent)
    const nestedMatch = line.match(/^  (\w+):\s*(.+)$/);
    if (nestedMatch && currentSection) {
      const section = result[currentSection] as YamlNode;
      let value = stripQuotes(nestedMatch[2].trim());

      // Resolve ${ENV_VAR} references
      value = value.replace(/\$\{(\w+)\}/g, (_, name: string) => process.env[name] ?? '');

      section[nestedMatch[1]] = value;
      continue;
    }

    // Deeper nested key: value (4-space indent) for 'with' block
    const deepMatch = line.match(/^    (\w+):\s*(.+)$/);
    if (deepMatch && currentSection) {
      const section = result[currentSection] as YamlNode;
      if (!section['with'] || typeof section['with'] === 'string') {
        section['with'] = {};
      }
      let value = stripQuotes(deepMatch[2].trim());
      value = value.replace(/\$\{(\w+)\}/g, (_, name: string) => process.env[name] ?? '');
      (section['with'] as YamlNode)[deepMatch[1]] = value;
    }
  }

  // Convert YamlNode to DotAiConfig
  const config: DotAiConfig = {};
  const providerKeys = ['memory', 'skills', 'identity', 'routing', 'tasks', 'tools'] as const;

  for (const key of providerKeys) {
    const section = result[key];
    if (section && typeof section === 'object') {
      const node = section as YamlNode;
      const providerConfig: ProviderConfig = {
        use: typeof node['use'] === 'string' ? node['use'] : '',
      };
      if (node['with'] && typeof node['with'] === 'object') {
        providerConfig.with = node['with'] as Record<string, unknown>;
      }
      config[key] = providerConfig;
    }
  }

  // Parse debug section
  const debugSection = result['debug'];
  if (debugSection && typeof debugSection === 'object') {
    const node = debugSection as YamlNode;
    config.debug = {};
    if (typeof node['logPath'] === 'string') {
      config.debug.logPath = node['logPath'];
    }
  }

  // Parse workspace section
  const workspaceSection = result['workspace'];
  if (workspaceSection && typeof workspaceSection === 'object') {
    const node = workspaceSection as YamlNode;
    config.workspace = {};
    if (typeof node['scanDirs'] === 'string') {
      config.workspace.scanDirs = node['scanDirs'];
    }
  }

  // Parse hooks section
  const hooksSection = result['hooks'];
  if (hooksSection && typeof hooksSection === 'object') {
    // hooks section needs special parsing — re-parse from raw lines
    config.hooks = parseHooksSection(raw);
  }

  // Parse extensions section
  const extensionsSection = result['extensions'];
  if (extensionsSection && typeof extensionsSection === 'object') {
    config.extensions = parseExtensionsSection(raw);
  }

  // Parse prompts section
  const promptsSection = result['prompts'];
  if (promptsSection && typeof promptsSection === 'object') {
    const node = promptsSection as YamlNode;
    const prompts: PromptsConfig = {};
    if (typeof node['use'] === 'string') {
      prompts.use = node['use'];
    }
    if (node['with'] && typeof node['with'] === 'object') {
      prompts.with = node['with'] as Record<string, unknown>;
    }
    config.prompts = prompts;
  }

  return config;
}

function parseHooksSection(raw: string): HooksConfig {
  const hooks: HooksConfig = {};
  const lines = raw.split('\n');
  let inHooks = false;
  let currentEvent: string | null = null;
  let currentEntry: { use?: string; with?: Record<string, unknown> } | null = null;

  for (const line of lines) {
    // Detect hooks: top-level
    if (line.match(/^hooks:$/)) {
      inHooks = true;
      continue;
    }
    // Exit hooks section on next top-level key
    if (inHooks && line.match(/^\w+:/) && !line.match(/^hooks:/)) {
      inHooks = false;
      // Flush last entry
      if (currentEntry?.use && currentEvent) {
        pushHookEntry(hooks, currentEvent, currentEntry as { use: string; with?: Record<string, unknown> });
      }
      break;
    }
    if (!inHooks) continue;

    // Event name (2-space indent): "  after_enrich:"
    const eventMatch = line.match(/^  (\w+):$/);
    if (eventMatch) {
      // Flush previous entry
      if (currentEntry?.use && currentEvent) {
        pushHookEntry(hooks, currentEvent, currentEntry as { use: string; with?: Record<string, unknown> });
      }
      currentEvent = eventMatch[1];
      currentEntry = null;
      continue;
    }

    // List item start (4-space indent + dash): "    - use: ..."
    const listItemMatch = line.match(/^    - (\w+):\s*(.+)$/);
    if (listItemMatch && currentEvent) {
      // Flush previous entry
      if (currentEntry?.use) {
        pushHookEntry(hooks, currentEvent, currentEntry as { use: string; with?: Record<string, unknown> });
      }
      currentEntry = { [listItemMatch[1]]: stripQuotes(listItemMatch[2].trim()) };
      continue;
    }

    // Continuation of list item (6-space indent): "      key: value"
    const contMatch = line.match(/^      (\w+):\s*(.+)$/);
    if (contMatch && currentEntry) {
      const key = contMatch[1];
      const value = stripQuotes(contMatch[2].trim());
      if (key === 'with') {
        // 'with' needs to be an object — handled in deeper indent
        currentEntry.with = {};
      } else if (currentEntry.with !== undefined) {
        // We're already in a 'with' block — but wait, this could be a direct property
        (currentEntry as Record<string, unknown>)[key] = value;
      } else {
        (currentEntry as Record<string, unknown>)[key] = value;
      }
      continue;
    }

    // Deep nested (8-space indent) for with block: "        option: value"
    const deepMatch = line.match(/^        (\w+):\s*(.+)$/);
    if (deepMatch && currentEntry) {
      if (!currentEntry.with) currentEntry.with = {};
      currentEntry.with[deepMatch[1]] = stripQuotes(deepMatch[2].trim());
      continue;
    }
  }

  // Flush last entry
  if (currentEntry?.use && currentEvent) {
    pushHookEntry(hooks, currentEvent, currentEntry as { use: string; with?: Record<string, unknown> });
  }

  return hooks;
}

function parseExtensionsSection(raw: string): ExtensionsConfig {
  const extensions: ExtensionsConfig = {};
  const lines = raw.split('\n');
  let inExtensions = false;
  let currentKey: 'paths' | 'packages' | null = null;

  for (const line of lines) {
    if (line.match(/^extensions:$/)) {
      inExtensions = true;
      continue;
    }
    // Exit on next top-level key
    if (inExtensions && line.match(/^\w+:/) && !line.match(/^extensions:/)) {
      break;
    }
    if (!inExtensions) continue;

    // Key with inline array: "  paths: [".ai/extensions/"]"
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

    // Key introducing a list: "  paths:"
    const keyMatch = line.match(/^\s{2}(\w+):$/);
    if (keyMatch) {
      currentKey = keyMatch[1] as 'paths' | 'packages';
      extensions[currentKey] = [];
      continue;
    }

    // List item: "    - value"
    const listItemMatch = line.match(/^\s{4}-\s*(.+)$/);
    if (listItemMatch && currentKey) {
      if (!extensions[currentKey]) extensions[currentKey] = [];
      extensions[currentKey]!.push(stripQuotes(listItemMatch[1].trim()));
    }
  }

  return extensions;
}

function pushHookEntry(
  hooks: HooksConfig,
  event: string,
  entry: { use: string; with?: Record<string, unknown> },
): void {
  const validEvents = ['after_boot', 'after_enrich', 'after_format', 'after_learn'] as const;
  if (!validEvents.includes(event as typeof validEvents[number])) return;
  const key = event as keyof HooksConfig;
  if (!hooks[key]) hooks[key] = [];
  hooks[key]!.push(entry);
}
