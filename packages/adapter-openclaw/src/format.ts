import type { EnrichedContext, MemoryEntry, Skill, Tool, RoutingResult } from '@dot-ai/core';

/**
 * Format an EnrichedContext into markdown sections for injection into OpenClaw agent context.
 * Sections are ordered by priority: identity > memory > skills > tools > routing.
 */
export function formatContext(ctx: EnrichedContext): string {
  const sections: string[] = [];

  // Identity sections (sorted by priority, highest first)
  const sortedIdentities = [...ctx.identities].sort((a, b) => b.priority - a.priority);
  for (const identity of sortedIdentities) {
    if (identity.content) {
      sections.push(identity.content);
    }
  }

  // Memory section
  if (ctx.memories.length > 0) {
    sections.push(formatMemory(ctx.memories));
  }

  // Skills section
  const loadedSkills = ctx.skills.filter(s => s.content);
  if (loadedSkills.length > 0) {
    sections.push(formatSkills(loadedSkills));
  }

  // Tools section
  if (ctx.tools.length > 0) {
    sections.push(formatTools(ctx.tools));
  }

  // Routing hint
  if (ctx.routing.model !== 'default') {
    sections.push(formatRouting(ctx.routing));
  }

  return sections.join('\n\n---\n\n');
}

function formatMemory(memories: MemoryEntry[]): string {
  const lines = ['## Relevant Memory\n'];
  for (const m of memories.slice(0, 10)) { // Limit to 10 most relevant
    const date = m.date ? ` (${m.date})` : '';
    lines.push(`- ${m.content}${date}`);
  }
  return lines.join('\n');
}

function formatSkills(skills: Skill[]): string {
  const lines = ['## Active Skills\n'];
  for (const s of skills) {
    lines.push(`### ${s.name}`);
    if (s.content) {
      lines.push(s.content);
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
