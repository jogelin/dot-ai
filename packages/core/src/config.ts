import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DotAiConfig, HooksConfig, ProviderConfig } from './types.js';
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
  return result;
}

/**
 * Load and parse dot-ai.yml from a workspace root.
 * Returns the config with defaults applied.
 *
 * Uses a minimal YAML parser (key: value pairs + nested objects).
 * No dependency on yaml package.
 */
export async function loadConfig(workspaceRoot: string): Promise<DotAiConfig> {
  const configPath = join(workspaceRoot, '.ai', 'dot-ai.yml');

  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch {
    // No config file — return empty config (all defaults)
    return {};
  }

  return parseYaml(raw);
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
