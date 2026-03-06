/**
 * @deprecated Provider loader — legacy provider registry.
 * In v6, extensions are loaded directly by the runtime. Will be removed in v7.
 * @module
 */

import type { DotAiConfig, Task } from './types.js';
import type {
  MemoryProvider,
  SkillProvider,
  IdentityProvider,
  RoutingProvider,
  TaskProvider,
  ToolProvider,
} from './contracts.js';
import type { Providers } from './engine.js';
import { resolveConfig } from './config.js';
/**
 * Registry of provider factories.
 * Adapters register their providers here before boot.
 */
// Use globalThis to share the registry across module instances.
// When loaded via jiti (e.g., OpenClaw gateway), the same package may be instantiated
// multiple times with separate module scopes. A global registry ensures that
// registerProvider() calls from the adapter are visible to the runtime's resolve().
const REGISTRY_KEY = '__dotai_provider_registry__';
const registry: Map<string, (options: Record<string, unknown>) => unknown> =
  ((globalThis as Record<string, unknown>)[REGISTRY_KEY] as Map<string, (options: Record<string, unknown>) => unknown>) ??
  (() => {
    const map = new Map<string, (options: Record<string, unknown>) => unknown>();
    (globalThis as Record<string, unknown>)[REGISTRY_KEY] = map;
    return map;
  })();

/** Cache for dynamic imports — same package imported once, reused across roles */
const importCache = new Map<string, Record<string, unknown>>();

/**
 * Register a provider factory.
 * Call this before createProviders().
 *
 * @example
 * registerProvider('@dot-ai/cockpit-memory', (opts) => new CockpitMemory(opts.url));
 */
export function registerProvider(
  name: string,
  factory: (options: Record<string, unknown>) => unknown,
): void {
  registry.set(name, factory);
}

/**
 * Clear all registered providers.
 * Useful for testing.
 */
export function clearProviders(): void {
  registry.clear();
  importCache.clear();
}

/**
 * Register all default file-based providers.
 * Call this at startup if you want file-based defaults available.
 */
export function registerDefaults(): void {
  // Default providers are now separate packages (@dot-ai/ext-file-memory, etc.)
  // They are resolved via auto-discovery in resolve() → tryImportProvider()
  // No explicit registration needed — the package names match the config defaults.
}

/**
 * Create providers from config.
 * Only creates providers that are explicitly configured in the config.
 * Unconfigured providers return undefined — the host agent handles those features.
 * When a configured provider fails to load, falls back to the noop implementation.
 */
export async function createProviders(config: DotAiConfig): Promise<Providers> {
  const resolved = resolveConfig(config);

  return {
    memory: resolved.memory
      ? await resolve<MemoryProvider>(resolved.memory.use, 'memory', resolved.memory.with ?? {}, noopMemory)
      : undefined,
    skills: resolved.skills
      ? await resolve<SkillProvider>(resolved.skills.use, 'skills', resolved.skills.with ?? {}, noopSkills)
      : undefined,
    identity: resolved.identity
      ? await resolve<IdentityProvider>(resolved.identity.use, 'identity', resolved.identity.with ?? {}, noopIdentity)
      : undefined,
    routing: resolved.routing
      ? await resolve<RoutingProvider>(resolved.routing.use, 'routing', resolved.routing.with ?? {}, noopRouting)
      : undefined,
    tasks: resolved.tasks
      ? await resolve<TaskProvider>(resolved.tasks.use, 'tasks', resolved.tasks.with ?? {}, noopTasks)
      : undefined,
    tools: resolved.tools
      ? await resolve<ToolProvider>(resolved.tools.use, 'tools', resolved.tools.with ?? {}, noopTools)
      : undefined,
  };
}

async function resolve<T>(
  name: string,
  role: string,
  options: Record<string, unknown>,
  fallback: T,
): Promise<T> {
  const registryKey = `${name}:${role}`;
  let factory = registry.get(registryKey);

  if (!factory) {
    // Also check legacy key (just package name) for backward compatibility
    factory = registry.get(name);
  }

  if (!factory) {
    factory = await tryImportProvider(name, role);
    if (factory) {
      registry.set(registryKey, factory);
    }
  }

  if (!factory) return fallback;
  return factory(options) as T;
}

/**
 * Try to import a provider package dynamically.
 * Looks for: role-specific export, default export factory, createXxxProvider function, or XxxProvider class.
 */
async function tryImportProvider(
  name: string,
  role?: string,
): Promise<((options: Record<string, unknown>) => unknown) | undefined> {
  try {
    // Check import cache first
    let mod = importCache.get(name);
    if (!mod) {
      mod = await import(name) as Record<string, unknown>;
      importCache.set(name, mod);
    }

    // 1. If role specified, look for role-specific factory first
    // e.g. role="memory" -> createMemoryProvider or MemoryProvider
    if (role) {
      const capitalRole = role.charAt(0).toUpperCase() + role.slice(1);

      // Check for createXxxProvider factory (e.g., createMemoryProvider)
      const factoryName = `create${capitalRole}Provider`;
      if (typeof mod[factoryName] === 'function') {
        return mod[factoryName] as (options: Record<string, unknown>) => unknown;
      }

      // Check for XxxProvider class (e.g., MemoryProvider)
      const className = `${capitalRole}Provider`;
      if (typeof mod[className] === 'function') {
        return (opts: Record<string, unknown>) => new (mod![className] as new (opts: Record<string, unknown>) => unknown)(opts);
      }
    }

    // 2. Fallback: default export (function)
    if (typeof mod.default === 'function') {
      return mod.default as (options: Record<string, unknown>) => unknown;
    }

    // 3. Fallback: any createXxxProvider factory
    for (const [key, value] of Object.entries(mod)) {
      if (key.startsWith('create') && key.endsWith('Provider') && typeof value === 'function') {
        return value as (options: Record<string, unknown>) => unknown;
      }
    }

    // 4. Fallback: any XxxProvider class
    for (const [key, value] of Object.entries(mod)) {
      if (key.endsWith('Provider') && typeof value === 'function') {
        return (opts: Record<string, unknown>) => new (value as new (opts: Record<string, unknown>) => unknown)(opts);
      }
    }

    return undefined;
  } catch {
    // Package not found or import error — not a problem, fall back to noop
    return undefined;
  }
}

// ── No-op providers (safe fallbacks) ────────────────────────────────────────

const noopMemory: MemoryProvider = {
  async search(_query: string, _labels?: string[]) { return []; },
  async store(_entry) {},
  describe() { return 'No memory provider configured.'; },
};

const noopSkills: SkillProvider = {
  async list() { return []; },
  async match(_labels) { return []; },
  async load(_name: string) { return null; },
};

const noopIdentity: IdentityProvider = {
  async load() { return []; },
};

const noopRouting: RoutingProvider = {
  async route(_labels) { return { model: 'default', reason: 'no routing provider' }; },
};

const noopTasks: TaskProvider = {
  async list(_filter?) { return []; },
  async get(_id: string) { return null; },
  async create(task): Promise<Task> { return { id: crypto.randomUUID(), ...task }; },
  async update(id: string, patch: Partial<Task>): Promise<Task> {
    return { id, text: '', status: '', ...patch };
  },
};

const noopTools: ToolProvider = {
  async list() { return []; },
  async match(_labels) { return []; },
  async load(_name: string) { return null; },
};
