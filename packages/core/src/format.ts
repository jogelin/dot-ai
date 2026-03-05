import type { EnrichedContext, MemoryEntry, Skill, Task, Tool, RoutingResult, BudgetWarning } from './types.js';
import type { Logger } from './logger.js';
import type { ResolvedHook } from './hooks.js';
import { runAfterFormat } from './hooks.js';

export interface FormatOptions {
  /** Skip identity sections (useful when already injected at session start) */
  skipIdentities?: boolean;
  /** Max chars per skill content. Truncated skills get a [...truncated] marker. Default: unlimited */
  maxSkillLength?: number;
  /** Max number of skills to include (already sorted by match relevance). Default: unlimited */
  maxSkills?: number;
  /** Max estimated tokens (chars / 4). When exceeded, content is trimmed. Default: no limit */
  tokenBudget?: number;
  /** Called when budget was exceeded and trimming occurred. Diagnostic signal. */
  onBudgetExceeded?: (warning: BudgetWarning) => void;
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

  // Recent tasks section
  if (ctx.recentTasks && ctx.recentTasks.length > 0) {
    sections.push(formatTasks(ctx.recentTasks));
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

  // Budget enforcement — trim if over token budget
  if (options?.tokenBudget != null) {
    const estimate = () => Math.round(sections.join('\n\n---\n\n').length / 4);
    let current = estimate();

    if (current > options.tokenBudget) {
      const actions: string[] = [];
      const skillSectionIdx = sections.findIndex(s => s.startsWith('## Active Skills'));
      const memorySectionIdx = sections.findIndex(s => s.startsWith('## Relevant Memory'));

      // Strategy 1: Truncate skill content to 2000 chars (preserves all skills, just shorter)
      if (current > options.tokenBudget && skillSectionIdx !== -1 && options?.maxSkillLength == null) {
        const longSkills = loadedSkills.filter(s => (s.content?.length ?? 0) > 2000).length;
        if (longSkills > 0) {
          sections[skillSectionIdx] = formatSkills(loadedSkills, 2000);
          actions.push(`truncated ${longSkills} skills to 2000 chars`);
          current = estimate();
        }
      }

      // Strategy 2: Drop oldest memories (keep most recent 5)
      if (current > options.tokenBudget && memorySectionIdx !== -1 && ctx.memories.length > 5) {
        const kept = ctx.memories.slice(0, 5);
        const dropped = ctx.memories.length - 5;
        sections[memorySectionIdx] = formatMemory(kept, ctx.memoryDescription);
        actions.push(`dropped ${dropped} oldest memories`);
        current = estimate();
      }

      // Strategy 3: Drop skills by reverse order (least relevant last in the array)
      if (current > options.tokenBudget && skillSectionIdx !== -1 && loadedSkills.length > 1) {
        while (loadedSkills.length > 1 && estimate() > options.tokenBudget) {
          const dropped = loadedSkills.pop()!;
          actions.push(`dropped skill: ${dropped.name}`);
          sections[skillSectionIdx] = formatSkills(loadedSkills, options?.maxSkillLength ?? 2000);
        }
        current = estimate();
      }

      // Emit warning if any trimming occurred
      if (actions.length > 0) {
        const warning: BudgetWarning = {
          budget: options.tokenBudget,
          actual: current,
          actions,
        };
        options.onBudgetExceeded?.(warning);

        options?.logger?.log({
          timestamp: new Date().toISOString(),
          level: current > options.tokenBudget ? 'warn' : 'info',
          phase: 'format',
          event: 'budget_trimmed',
          data: warning as unknown as Record<string, unknown>,
          durationMs: Math.round(performance.now() - start),
        });
      } else if (current > options.tokenBudget) {
        // Budget exceeded but nothing could be trimmed (identities alone exceed budget)
        const warning: BudgetWarning = {
          budget: options.tokenBudget,
          actual: current,
          actions: ['budget exceeded by non-trimmable content (identities)'],
        };
        options.onBudgetExceeded?.(warning);

        options?.logger?.log({
          timestamp: new Date().toISOString(),
          level: 'warn',
          phase: 'format',
          event: 'budget_exceeded_no_action',
          data: warning as unknown as Record<string, unknown>,
          durationMs: Math.round(performance.now() - start),
        });
      }
    }
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

/**
 * Apply after_format hooks to a formatted context string.
 * Call this after formatContext() if hooks are configured.
 */
export async function applyFormatHooks(
  formatted: string,
  ctx: EnrichedContext,
  hooks: ResolvedHook[],
  logger?: Logger,
): Promise<string> {
  return runAfterFormat(hooks, formatted, ctx, logger);
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

function formatTasks(tasks: Task[]): string {
  const lines = ['## Current Tasks (In Progress)\n'];
  for (const t of tasks.slice(0, 10)) {
    const project = t.project ? ` [${t.project}]` : '';
    const priority = t.priority ? ` (${t.priority})` : '';
    lines.push(`- ${t.text}${project}${priority}`);
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
