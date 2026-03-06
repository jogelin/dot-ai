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
  WorkspaceConfig,
  BudgetWarning,
  PromptTemplate,
  ExtensionsConfig,
  PromptsConfig,
} from './types.js';

// ── Extension Types ──
export type {
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
  ContextInjectEvent, ContextInjectResult,
  ContextModifyEvent, ContextModifyResult,
} from './extension-types.js';
export { EVENT_TIERS, ADAPTER_CAPABILITIES, TOOL_STRATEGY } from './extension-types.js';

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
export { formatContext, formatToolHints } from './format.js';
export type { FormatOptions } from './format.js';

// ── Capabilities ──
export { toolDefinitionToCapability } from './capabilities.js';
export type { Capability, CapabilityResult } from './capabilities.js';

// ── Logger ──
export type { LogLevel, LogEntry, Logger } from './logger.js';
export { NoopLogger, JsonFileLogger, StderrLogger } from './logger.js';

// ── Config ──
export { loadConfig, migrateConfig } from './config.js';

// ── Package Manager ──
export { install, remove, listPackages, resolvePackages } from './package-manager.js';
export type { PackageInfo } from './package-manager.js';

// ── Boot Cache ──
export { computeChecksum, loadBootCache, writeBootCache, clearBootCache } from './boot-cache.js';
export type { BootCacheData } from './boot-cache.js';
