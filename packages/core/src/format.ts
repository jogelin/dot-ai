import type { EnrichedContext, MemoryEntry, Skill, Tool, RoutingResult } from './types.js';
import type { Logger } from './logger.js';

export interface FormatOptions {
  /** Skip identity sections (useful when already injected at session start) */
  skipIdentities?: boolean;
  /** Max chars per skill content. Truncated skills get a [...truncated] marker. Default: unlimited */
  maxSkillLength?: number;
  /** Max number of skills to include (already sorted by match relevance). Default: unlimited */
  maxSkills?: number;
  /** Optional logger for tracing */
  logger?: Logger;
}

/**
 * Format an EnrichedContext into markdown sections for injection into agent context.
 * Sections are ordered by priority: identity > memory > skills > tools > routing.
 */
export function formatContext(ctx: EnrichedContext, options?: FormatOptions): string {
  const start = performance.now();
  const sections: string[] = [];

  // Identity sections (sorted by priority, highest first)
  if (!options?.skipIdentities) {
    const sortedIdentities = [...ctx.identities].sort((a, b) => b.priority - a.priority);
    for (const identity of sortedIdentities) {
      if (identity.content) {
        sections.push(identity.content);
      }
    }
  }

  // Memory section
  if (ctx.memories.length > 0 || ctx.memoryDescription) {
    sections.push(formatMemory(ctx.memories, ctx.memoryDescription));
  }

  // Skills section
  let loadedSkills = ctx.skills.filter(s => s.content);
  if (options?.maxSkills != null) {
    loadedSkills = loadedSkills.slice(0, options.maxSkills);
  }
  if (loadedSkills.length > 0) {
    sections.push(formatSkills(loadedSkills, options?.maxSkillLength));
  }

  // Tools section
  if (ctx.tools.length > 0) {
    sections.push(formatTools(ctx.tools));
  }

  // Routing hint
  if (ctx.routing.model !== 'default') {
    sections.push(formatRouting(ctx.routing));
  }

  const result = sections.join('\n\n---\n\n');

  options?.logger?.log({
    timestamp: new Date().toISOString(),
    level: 'info',
    phase: 'format',
    event: 'format_complete',
    data: {
      outputChars: result.length,
      estimatedTokens: Math.round(result.length / 4),
      skillsIncluded: loadedSkills.map(s => s.name),
      truncatedSkills: loadedSkills
        .filter(s => options?.maxSkillLength != null && (s.content?.length ?? 0) > options.maxSkillLength)
        .map(s => s.name),
    },
    durationMs: Math.round(performance.now() - start),
  });

  return result;
}

function formatMemory(memories: MemoryEntry[], description?: string): string {
  const lines = ['## Relevant Memory\n'];
  if (description) {
    lines.push(`> ${description}\n`);
  }
  for (const m of memories.slice(0, 10)) { // Limit to 10 most relevant
    const date = m.date ? ` (${m.date})` : '';
    lines.push(`- ${m.content}${date}`);
  }
  return lines.join('\n');
}

function formatSkills(skills: Skill[], maxLength?: number): string {
  const lines = ['## Active Skills\n'];
  for (const s of skills) {
    lines.push(`### ${s.name}`);
    if (s.content) {
      if (maxLength != null && s.content.length > maxLength) {
        lines.push(s.content.slice(0, maxLength) + '\n\n[...truncated]');
      } else {
        lines.push(s.content);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function formatTools(tools: Tool[]): string {
  const lines = ['## Available Tools\n'];
  for (const t of tools) {
    lines.push(`- **${t.name}**: ${t.description}`);
  }
  return lines.join('\n');
}

function formatRouting(routing: RoutingResult): string {
  return `## Model Routing\n\nRecommended model: **${routing.model}** (${routing.reason})`;
}
