import fs from "node:fs/promises";
import path from "node:path";

/**
 * Workspace configuration loaded from .ai/config.yaml
 *
 * Allows workspaces to override default providers (file-based)
 * with custom implementations (Cockpit API, remote DB, etc.).
 *
 * Environment variable references (${VAR_NAME}) are resolved at load time.
 */
export interface WorkspaceConfig {
  providers?: {
    tasks?: TaskProviderConfig;
    memory?: MemoryProviderConfig;
  };
}

export interface TaskProviderConfig {
  /** Provider type: "file" (default) or "cockpit" */
  type: "file" | "cockpit";
  /** Base URL for API-based providers */
  url?: string;
  /** API key (supports ${ENV_VAR} syntax) */
  apiKey?: string;
}

export interface MemoryProviderConfig {
  /** Provider type: "file" (default) */
  type: "file";
}

/**
 * Load workspace config from .ai/config.yaml
 *
 * Returns default config if file doesn't exist.
 * Resolves ${ENV_VAR} references in string values.
 */
export async function loadConfig(rootDir: string): Promise<WorkspaceConfig> {
  const configPath = path.join(rootDir, ".ai", "config.yaml");

  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf-8");
  } catch {
    return {}; // No config = all defaults
  }

  // Simple YAML parser for our flat config structure
  // Avoids adding a yaml dependency to core
  const config = parseSimpleYaml(raw);
  return resolveEnvVars(config) as WorkspaceConfig;
}

/**
 * Minimal YAML parser for dot-ai config.
 *
 * Supports:
 * - Nested keys via indentation (2 spaces)
 * - String values (quoted or unquoted)
 * - Comments (#)
 *
 * Does NOT support: arrays, multi-line strings, anchors, etc.
 * For those, use the `yaml` package at the workspace level.
 */
function parseSimpleYaml(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const stack: { indent: number; obj: Record<string, unknown> }[] = [
    { indent: -1, obj: result },
  ];

  for (const line of raw.split("\n")) {
    // Skip empty lines and comments
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = line.length - trimmed.length;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    // Pop stack to find parent at correct indentation
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    if (rawValue === "" || rawValue === "|" || rawValue === ">") {
      // Nested object
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      // Scalar value — strip quotes
      const value = rawValue.replace(/^["']|["']$/g, "");
      parent[key] = value;
    }
  }

  return result;
}

/**
 * Resolve ${ENV_VAR} references in all string values.
 */
function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{(\w+)\}/g, (_match, varName) => {
      return process.env[varName] ?? "";
    });
  }
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      resolved[key] = resolveEnvVars(value);
    }
    return resolved;
  }
  return obj;
}
