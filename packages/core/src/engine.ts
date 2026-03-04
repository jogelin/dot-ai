import type {
  MemoryProvider,
  SkillProvider,
  IdentityProvider,
  RoutingProvider,
  TaskProvider,
  ToolProvider,
} from './contracts.js';
import type { EnrichedContext, Identity, Skill } from './types.js';
import type { Logger } from './logger.js';
import { extractLabels, buildVocabulary } from './labels.js';

/**
 * All providers needed by the engine.
 */
export interface Providers {
  memory: MemoryProvider;
  skills: SkillProvider;
  identity: IdentityProvider;
  routing: RoutingProvider;
  tasks: TaskProvider;
  tools: ToolProvider;
}

/**
 * Cached data from boot phase. Reused across prompts.
 */
export interface BootCache {
  identities: Identity[];
  vocabulary: string[];
  skills: Skill[];
}

/**
 * Boot phase — run once per session.
 * Loads identities, indexes skills/tools, builds label vocabulary.
 */
export async function boot(providers: Providers, logger?: Logger): Promise<BootCache> {
  const start = performance.now();

  const [identities, skills, tools] = await Promise.all([
    providers.identity.load(),
    providers.skills.list(),
    providers.tools.list(),
  ]);

  // Build vocabulary from skill labels, skill triggers (excluding meta-triggers), and tool labels
  const META_TRIGGERS = new Set(['always', 'auto', 'manual', 'boot', 'heartbeat', 'pipeline', 'audit']);
  const skillTriggers = skills.map((s) =>
    (s.triggers ?? []).filter((t) => !META_TRIGGERS.has(t)),
  );

  const vocabulary = buildVocabulary(
    [...skills.map((s) => s.labels), ...skillTriggers],
    tools.map((t) => t.labels),
  );

  logger?.log({
    timestamp: new Date().toISOString(),
    level: 'info',
    phase: 'boot',
    event: 'boot_complete',
    data: { identityCount: identities.length, skillCount: skills.length, vocabularySize: vocabulary.length },
    durationMs: Math.round(performance.now() - start),
  });

  return { identities, vocabulary, skills };
}

/**
 * Enrich a prompt — run per prompt.
 * Calls all providers to build an EnrichedContext.
 */
export async function enrich(
  prompt: string,
  providers: Providers,
  cache: BootCache,
  logger?: Logger,
): Promise<EnrichedContext> {
  const start = performance.now();

  // 1. Extract labels from prompt against known vocabulary
  const labels = extractLabels(prompt, cache.vocabulary);

  logger?.log({
    timestamp: new Date().toISOString(),
    level: 'info',
    phase: 'enrich',
    event: 'labels_extracted',
    data: { labels: labels.map(l => l.name), vocabularySize: cache.vocabulary.length },
    durationMs: Math.round(performance.now() - start),
  });

  // 2. Search memory + match skills + match tools + route — all in parallel
  const [memories, matchedSkills, matchedTools, routing] = await Promise.all([
    providers.memory.search(prompt, labels.map((l) => l.name)),
    providers.skills.match(labels),
    providers.tools.match(labels),
    providers.routing.route(labels),
  ]);

  logger?.log({
    timestamp: new Date().toISOString(),
    level: 'info',
    phase: 'enrich',
    event: 'enrich_complete',
    data: {
      labelCount: labels.length,
      memoryCount: memories.length,
      skillCount: matchedSkills.length,
      routing: routing.model,
    },
    durationMs: Math.round(performance.now() - start),
  });

  return {
    prompt,
    labels,
    identities: cache.identities,
    memories,
    skills: matchedSkills,
    tools: matchedTools,
    routing,
  };
}

/**
 * Learn phase — run after agent response.
 * Stores learnings in memory.
 */
export async function learn(
  response: string,
  providers: Providers,
): Promise<void> {
  const MAX_LEARN_LENGTH = 500;
  const truncated = response.length > MAX_LEARN_LENGTH
    ? response.slice(0, MAX_LEARN_LENGTH) + '…'
    : response;

  await providers.memory.store({
    content: truncated,
    type: 'log',
    date: new Date().toISOString().slice(0, 10),
  });
}
