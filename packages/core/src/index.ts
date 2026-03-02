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
