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
const registry = new Map<string, (options: Record<string, unknown>) => unknown>();

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
}

/**
 * Create all providers from config.
 * Falls back to no-op providers for any missing registration.
 */
export async function createProviders(config: DotAiConfig): Promise<Providers> {
  const resolved = resolveConfig(config);

  return {
    memory: await resolve<MemoryProvider>(resolved.memory.use, resolved.memory.with ?? {}, noopMemory),
    skills: await resolve<SkillProvider>(resolved.skills.use, resolved.skills.with ?? {}, noopSkills),
    identity: await resolve<IdentityProvider>(resolved.identity.use, resolved.identity.with ?? {}, noopIdentity),
    routing: await resolve<RoutingProvider>(resolved.routing.use, resolved.routing.with ?? {}, noopRouting),
    tasks: await resolve<TaskProvider>(resolved.tasks.use, resolved.tasks.with ?? {}, noopTasks),
    tools: await resolve<ToolProvider>(resolved.tools.use, resolved.tools.with ?? {}, noopTools),
  };
}

async function resolve<T>(name: string, options: Record<string, unknown>, fallback: T): Promise<T> {
  const factory = registry.get(name);
  if (!factory) return fallback;
  return factory(options) as T;
}

// ── No-op providers (safe fallbacks) ────────────────────────────────────────

const noopMemory: MemoryProvider = {
  async search(_query: string, _labels?: string[]) { return []; },
  async store(_entry) {},
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
