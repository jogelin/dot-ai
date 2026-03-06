/**
 * @dot-ai/core v6 — Headless Agent framework.
 *
 * dot-ai = extensions (event-driven plugins) + adapters (agent integration).
 * Everything is an extension. Core orchestrates events, adapters map to agent runtimes.
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
  PromptTemplate,
  ExtensionsConfig,
  PromptsConfig,
} from './types.js';

// ── Extension Types ──
export type {
  // v6 types
  Section,
  ResourceEntry,
  ResourcesDiscoverResult,
  LabelExtractEvent,
  ContextEnrichEvent,
  ContextEnrichResult,
  CollectedSections,
  RouteEvent,
  RouteResult,
  InputEvent,
  InputResult,
  CommandParameter,
  CommandResult,
  CommandDefinition,
  // Shared types
  ToolDefinition,
  ExtensionContext,
  ExtensionEvent,
  ExtensionTier,
  ExtensionEventName,
  LoadedExtension,
  ExtensionDiagnostic,
  ToolCallEvent, ToolCallResult,
  ToolResultEvent,
  AgentEndEvent,
  Message,
  // Legacy (deprecated)
  ContextInjectEvent, ContextInjectResult,
  ContextModifyEvent, ContextModifyResult,
} from './extension-types.js';
export { EVENT_TIERS, ADAPTER_CAPABILITIES, TOOL_STRATEGY } from './extension-types.js';

// ── Extension Runner ──
export { ExtensionRunner, EventBus } from './extension-runner.js';

// ── Extension API (v6) ──
export type { ExtensionAPI, ExtensionContextV6 } from './extension-api.js';
// ── Extension API (deprecated v5) ──
export type { DotAiExtensionAPI, DotAiExtensionContext } from './extension-api.js';

// ── Extension Loader ──
export { discoverExtensions, loadExtensions, createV6CollectorAPI } from './extension-loader.js';

// ── Runtime ──
export { DotAiRuntime } from './runtime.js';
export type { RuntimeOptions, ProcessResult, RuntimeDiagnostics } from './runtime.js';

// ── Labels ──
export { extractLabels, buildVocabulary } from './labels.js';

// ── Nodes ──
export { discoverNodes, parseScanDirs } from './nodes.js';

// ── Format ──
export { formatContext, applyFormatHooks, formatToolHints } from './format.js';
export type { FormatOptions } from './format.js';

// ── Capabilities ──
export { buildCapabilities, toolDefinitionToCapability } from './capabilities.js';
export type { Capability, CapabilityResult } from './capabilities.js';

// ── Logger ──
export type { LogLevel, LogEntry, Logger } from './logger.js';
export { NoopLogger, JsonFileLogger, StderrLogger } from './logger.js';

// ── Config ──
export { loadConfig, resolveConfig, injectRoot, migrateConfig } from './config.js';
export type { ResolvedConfig } from './config.js';

// ── Package Manager ──
export { install, remove, listPackages, resolvePackages } from './package-manager.js';
export type { PackageInfo } from './package-manager.js';

// ── Boot Cache ──
export { computeChecksum, loadBootCache, writeBootCache, clearBootCache } from './boot-cache.js';
export type { BootCacheData } from './boot-cache.js';

// ══════════════════════════════════════════════════════════════════════════════
// DEPRECATED — Legacy provider pipeline. Will be removed in v7.
// Use DotAiRuntime with extensions instead.
// ══════════════════════════════════════════════════════════════════════════════

// ── Contracts (deprecated) ──
/** @deprecated Use extensions instead */
export type {
  MemoryProvider,
  SkillProvider,
  IdentityProvider,
  RoutingProvider,
  TaskProvider,
  ToolProvider,
  PromptProvider,
  ProviderFactory,
} from './contracts.js';

// ── Engine (deprecated) ──
/** @deprecated Use DotAiRuntime instead */
export { boot, enrich, learn } from './engine.js';
/** @deprecated */
export type { Providers, BootCache } from './engine.js';

// ── Hooks (deprecated) ──
/** @deprecated Use extension event handlers instead */
export { loadHooks, runAfterBoot, runAfterEnrich, runAfterFormat, runAfterLearn } from './hooks.js';
/** @deprecated */
export type { HookEvent, HookHandler, ResolvedHook } from './hooks.js';

// ── Loader (deprecated) ──
/** @deprecated Use extensions instead */
export { registerProvider, clearProviders, createProviders, registerDefaults } from './loader.js';
