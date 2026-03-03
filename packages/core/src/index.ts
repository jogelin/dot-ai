/**
 * @dot-ai/core v4 — Contracts and types for the dot-ai convention.
 *
 * dot-ai = contracts (interfaces) + providers (pluggable implementations) + adapters (agent integration).
 * Core defines WHAT, providers define HOW, adapters define WHERE.
 */

// ── Types ──
export type {
  Label,
  MemoryEntry,
  Skill,
  Identity,
  Task,
  Tool,
  RoutingResult,
  EnrichedContext,
  TaskFilter,
  DotAiConfig,
  ProviderConfig,
} from './types.js';

// ── Contracts ──
export type {
  MemoryProvider,
  SkillProvider,
  IdentityProvider,
  RoutingProvider,
  TaskProvider,
  ToolProvider,
  ProviderFactory,
} from './contracts.js';

// ── Engine ──
export { boot, enrich, learn } from './engine.js';
export type { Providers, BootCache } from './engine.js';

// ── Config ──
export { loadConfig, resolveConfig, injectRoot } from './config.js';

// ── Format ──
export { formatContext } from './format.js';
export type { FormatOptions } from './format.js';

// ── Loader ──
export { registerProvider, clearProviders, createProviders } from './loader.js';

// ── Labels ──
export { extractLabels, buildVocabulary } from './labels.js';

// ── Default Providers ──
export {
  FileMemoryProvider,
  FileSkillProvider,
  FileIdentityProvider,
  RulesRoutingProvider,
  FileTaskProvider,
  FileToolProvider,
} from './providers/index.js';

// ── registerDefaults ──
export { registerDefaults } from './loader.js';
