import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DotAiConfig, ProviderConfig } from './types.js';
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
 * Resolve a config with defaults.
 * Any missing provider gets the built-in file-based default.
 */
export interface ResolvedConfig {
  memory: ProviderConfig;
  skills: ProviderConfig;
  identity: ProviderConfig;
  routing: ProviderConfig;
  tasks: ProviderConfig;
  tools: ProviderConfig;
  debug?: import('./types.js').DebugConfig;
}

export function resolveConfig(config: DotAiConfig): ResolvedConfig {
  return {
    memory: config.memory ?? { use: '@dot-ai/file-memory' },
    skills: config.skills ?? { use: '@dot-ai/file-skills' },
    identity: config.identity ?? { use: '@dot-ai/file-identity' },
    routing: config.routing ?? { use: '@dot-ai/rules-routing' },
    tasks: config.tasks ?? { use: '@dot-ai/file-tasks' },
    tools: config.tools ?? { use: '@dot-ai/file-tools' },
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

  return config;
}
