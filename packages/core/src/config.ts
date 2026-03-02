import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DotAiConfig, ProviderConfig } from './types.js';

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
export function resolveConfig(config: DotAiConfig): Required<DotAiConfig> {
  return {
    memory: config.memory ?? { use: '@dot-ai/file-memory' },
    skills: config.skills ?? { use: '@dot-ai/file-skills' },
    identity: config.identity ?? { use: '@dot-ai/file-identity' },
    routing: config.routing ?? { use: '@dot-ai/rules-routing' },
    tasks: config.tasks ?? { use: '@dot-ai/file-tasks' },
    tools: config.tools ?? { use: '@dot-ai/file-tools' },
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

  return config;
}
