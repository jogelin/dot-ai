/**
 * @dot-ai/core v7 — Headless Agent framework.
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
  WorkspaceConfig,
  BudgetWarning,
  PromptTemplate,
  ExtensionsConfig,
  PromptsConfig,
} from './types.js';

// ── Extension Types ──
export type {
  Section,
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
  ToolDefinition,
  ExtensionContext,
  ExtensionEvent,
  LoadedExtension,
  ExtensionDiagnostic,
  ToolCallEvent, ToolCallResult,
  ToolResultEvent,
  AgentEndEvent,
} from './extension-types.js';

// ── Extension Runner ──
export { ExtensionRunner, EventBus } from './extension-runner.js';

// ── Extension API ──
export type { ExtensionAPI, ExtensionContextV6 } from './extension-api.js';

// ── Extension Loader ──
export { discoverExtensions, createV6CollectorAPI } from './extension-loader.js';

// ── Runtime ──
export { DotAiRuntime } from './runtime.js';
export type { RuntimeOptions, ProcessResult, RuntimeDiagnostics } from './runtime.js';

// ── Labels ──
export { extractLabels, buildVocabulary } from './labels.js';

// ── Nodes ──
export { discoverNodes, parseScanDirs } from './nodes.js';

// ── Format ──
export { formatContext, formatToolHints, formatSections, assembleSections, trimSections } from './format.js';
export type { FormatOptions, FormatSectionsOptions } from './format.js';

// ── Capabilities ──
export { toolDefinitionToCapability } from './capabilities.js';
export type { Capability, CapabilityResult } from './capabilities.js';

// ── Logger ──
export type { LogLevel, LogEntry, Logger } from './logger.js';
export { NoopLogger, JsonFileLogger, StderrLogger } from './logger.js';

// ── Config ──
export { loadConfig, migrateConfig } from './config.js';

// ── Package Manager ──
export { install, remove, listPackages, resolvePackages, ensurePackagesInstalled } from './package-manager.js';
export type { PackageInfo, MissingPackageAction } from './package-manager.js';

// ── Boot Cache ──
export { computeChecksum, loadBootCache, writeBootCache, clearBootCache } from './boot-cache.js';
export type { BootCacheData } from './boot-cache.js';
