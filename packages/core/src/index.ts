/**
 * @dot-ai/core v4 — Contracts and types for the dot-ai convention.
 *
 * dot-ai = contracts (interfaces) + providers (pluggable implementations) + adapters (agent integration).
 * Core defines WHAT, providers define HOW, adapters define WHERE.
 */

// ── Types ──
export type {
  Label,
  Node,
  MemoryEntry,
  Skill,
  Identity,
  Task,
  Tool,
  RoutingResult,
  EnrichedContext,
  TaskFilter,
  DotAiConfig,
  DebugConfig,
  ProviderConfig,
  WorkspaceConfig,
  BudgetWarning,
  HookEntryConfig,
  HooksConfig,
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
export type { ResolvedConfig } from './config.js';

// ── Format ──
export { formatContext, applyFormatHooks } from './format.js';
export type { FormatOptions } from './format.js';

// ── Hooks ──
export { loadHooks, runAfterBoot, runAfterEnrich, runAfterFormat, runAfterLearn } from './hooks.js';
export type { HookEvent, HookHandler, ResolvedHook } from './hooks.js';

// ── Capabilities ──
export { buildCapabilities } from './capabilities.js';
export type { Capability, CapabilityResult } from './capabilities.js';

// ── Logger ──
export type { LogLevel, LogEntry, Logger } from './logger.js';
export { NoopLogger, JsonFileLogger, StderrLogger } from './logger.js';

// ── Loader ──
export { registerProvider, clearProviders, createProviders } from './loader.js';

// ── Labels ──
export { extractLabels, buildVocabulary } from './labels.js';

// ── Nodes ──
export { discoverNodes, parseScanDirs } from './nodes.js';

// ── registerDefaults ──
export { registerDefaults } from './loader.js';
