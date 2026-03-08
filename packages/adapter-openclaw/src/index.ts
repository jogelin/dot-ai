/**
 * dot-ai OpenClaw plugin v8
 *
 * Full integration with OpenClaw hook system:
 * - agent:bootstrap hook → removes ALL OpenClaw workspace files (dot-ai owns context)
 * - before_prompt_build → injects dot-ai context (static → prependSystemContext, dynamic → prependContext)
 * - agent_end → feeds response back to runtime
 * - Tools → delegates to runtime capabilities (memory, tasks, etc.)
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DotAiRuntime, assembleSections } from '@dot-ai/core';
import type { Section } from '@dot-ai/core';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json') as { version: string };

// ════════════════════════════════════════════════════════════════════════════
// Inline OpenClaw plugin API types (avoid hard dependency on OpenClaw internals)
// ════════════════════════════════════════════════════════════════════════════

interface OpenClawLogger {
  info(msg: string): void;
  debug?(msg: string): void;
  warn?(msg: string): void;
}

interface OpenClawPluginApi {
  logger: OpenClawLogger;
  pluginConfig?: Record<string, unknown>;
  on(
    event: string,
    handler: (event: unknown, ctx: Record<string, unknown>) => Promise<Record<string, unknown> | void> | void,
    options?: { priority?: number },
  ): void;
  registerHook(
    events: string | string[],
    handler: (event: InternalHookEvent) => Promise<void> | void,
    opts?: { name?: string; description?: string },
  ): void;
  registerService(service: {
    id: string;
    start(ctx: { logger: OpenClawLogger }): void;
    stop(ctx: { logger: OpenClawLogger }): void;
  }): void;
  registerTool(tool: OpenClawTool | OpenClawToolFactory, opts?: { name?: string; names?: string[] }): void;
}

interface InternalHookEvent {
  type: string;
  action: string;
  sessionKey: string;
  context: Record<string, unknown>;
  timestamp: Date;
  messages: string[];
}

interface BootstrapFile {
  name: string;
  path: string;
  content?: string;
  missing: boolean;
}

interface OpenClawToolResult {
  content: Array<{ type: string; text: string }>;
  details?: Record<string, unknown>;
}

interface OpenClawTool {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(toolCallId: string, params: Record<string, unknown>): Promise<OpenClawToolResult>;
}

type OpenClawToolFactory = (ctx: Record<string, unknown>) => OpenClawTool | OpenClawTool[] | null;

// ════════════════════════════════════════════════════════════════════════════
// Runtime cache
// ════════════════════════════════════════════════════════════════════════════

let cachedRuntime: DotAiRuntime | null = null;
let cachedWorkspace: string | null = null;

function hasWorkspace(dir: string): boolean {
  return existsSync(join(dir, '.ai'));
}

function resolveWorkspace(
  configuredWorkspace: string | undefined,
  ctxWorkspaceDir: string | undefined,
): string | null {
  const cwd = process.cwd();
  const cwdWorkspace = hasWorkspace(cwd) ? cwd : null;
  const raw = cwdWorkspace ?? configuredWorkspace ?? ctxWorkspaceDir;
  if (!raw) return null;
  // Strip trailing .ai/ if present
  return raw.endsWith('/.ai') || raw.endsWith('\\.ai') ? raw.slice(0, -4) : raw;
}

async function ensureRuntime(
  workspaceDir: string,
  logger: OpenClawLogger,
): Promise<DotAiRuntime> {
  if (cachedRuntime && cachedWorkspace === workspaceDir) {
    return cachedRuntime;
  }

  logger.info(`[dot-ai] workspaceRoot=${workspaceDir}`);
  cachedRuntime = new DotAiRuntime({ workspaceRoot: workspaceDir });
  await cachedRuntime.boot();
  cachedWorkspace = workspaceDir;
  logger.info(`[dot-ai] Runtime booted (v${PKG_VERSION})`);

  const diag = cachedRuntime.diagnostics;
  logger.info(`[dot-ai] extensions=${diag.extensions.length}, capabilities=${diag.capabilityCount}`);
  if (diag.vocabularySize !== undefined) {
    logger.info(`[dot-ai] Vocabulary size: ${diag.vocabularySize}`);
  }

  return cachedRuntime;
}

// ════════════════════════════════════════════════════════════════════════════
// Section splitting: static (cacheable) vs dynamic (per-turn)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Static sections = identity files + system section (trimStrategy: 'never').
 * These rarely change and benefit from provider prompt caching.
 *
 * Dynamic sections = memory, skills, tasks, tools, project agents.
 * These change based on the current prompt.
 */
function splitSections(sections: Section[]): { static: Section[]; dynamic: Section[] } {
  const staticSections: Section[] = [];
  const dynamicSections: Section[] = [];

  for (const section of sections) {
    if (section.trimStrategy === 'never') {
      staticSections.push(section);
    } else {
      dynamicSections.push(section);
    }
  }

  // Sort each group by priority DESC
  staticSections.sort((a, b) => b.priority - a.priority);
  dynamicSections.sort((a, b) => b.priority - a.priority);

  return { static: staticSections, dynamic: dynamicSections };
}

// ════════════════════════════════════════════════════════════════════════════
// Plugin definition
// ════════════════════════════════════════════════════════════════════════════

const plugin = {
  id: 'dot-ai',
  name: 'dot-ai — Universal AI Workspace Convention',
  version: PKG_VERSION,
  description: 'Deterministic context enrichment for OpenClaw agents',
  kind: 'memory' as const,

  register(api: OpenClawPluginApi) {
    api.logger.info(`[dot-ai] Plugin loaded (v${PKG_VERSION})`);

    const configuredWorkspace = api.pluginConfig?.workspace as string | undefined;
    if (configuredWorkspace) {
      api.logger.info(`[dot-ai] workspace from config: ${configuredWorkspace}`);
    }

    // ══════════════════════════════════════════════════════════════════════
    // Internal Hook: agent:bootstrap — remove ALL OpenClaw workspace files
    // dot-ai owns the full context; OpenClaw's AGENTS.md, SOUL.md, etc. are stubs.
    // ══════════════════════════════════════════════════════════════════════

    api.registerHook(
      'agent:bootstrap',
      (event: InternalHookEvent) => {
        if (event.type !== 'agent' || event.action !== 'bootstrap') return;
        const ctx = event.context as { bootstrapFiles?: BootstrapFile[] };
        if (!Array.isArray(ctx.bootstrapFiles)) return;

        const removed = ctx.bootstrapFiles.map(f => f.name);
        // Clear ALL bootstrap files — dot-ai provides everything
        ctx.bootstrapFiles = [];

        api.logger.debug?.(`[dot-ai] Removed ${removed.length} OpenClaw bootstrap files: ${removed.join(', ')}`);
      },
      { name: 'dot-ai-bootstrap-filter', description: 'Remove OpenClaw workspace files — dot-ai owns context' },
    );

    // ══════════════════════════════════════════════════════════════════════
    // Tools: delegate to runtime capabilities
    // ══════════════════════════════════════════════════════════════════════

    api.registerTool(
      (_ctx: Record<string, unknown>) => {
        if (!cachedRuntime?.isBooted) return null;
        return cachedRuntime.capabilities.map((cap): OpenClawTool => ({
          name: cap.name,
          label: cap.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          description: cap.description,
          parameters: cap.parameters,
          async execute(_toolCallId: string, params: Record<string, unknown>): Promise<OpenClawToolResult> {
            const result = await cap.execute(params);
            return {
              content: [{ type: 'text', text: result.text }],
              ...(result.details && { details: result.details }),
            };
          },
        }));
      },
      { names: ['memory_recall', 'memory_store', 'task_list', 'task_create', 'task_update'] },
    );

    // ══════════════════════════════════════════════════════════════════════
    // Plugin Hook: before_prompt_build — inject dot-ai context
    // Replaces legacy before_agent_start. Has access to messages[] and
    // supports prependSystemContext for prompt caching.
    // ══════════════════════════════════════════════════════════════════════

    api.on(
      'before_prompt_build',
      async (
        _event: unknown,
        ctx: Record<string, unknown>,
      ) => {
        const workspaceDir = resolveWorkspace(configuredWorkspace, ctx.workspaceDir as string | undefined);
        if (!workspaceDir) {
          api.logger.info('[dot-ai] No workspace found — skipping');
          return;
        }

        const sessionKey = ctx.sessionKey as string | undefined;
        const isSubagent = sessionKey?.includes(':subagent:') || sessionKey?.includes(':cron:');
        if (isSubagent) {
          api.logger.debug?.('[dot-ai] Sub-agent/cron session, skipping');
          return;
        }

        try {
          const runtime = await ensureRuntime(workspaceDir, api.logger);
          const prompt = ((_event as { prompt?: string })?.prompt) ?? '';
          const { sections } = await runtime.processPrompt(prompt);

          if (sections.length === 0) return;

          const { static: staticSections, dynamic: dynamicSections } = splitSections(sections);

          const result: Record<string, string> = {};

          // Static context → prependSystemContext (cached by providers like Anthropic)
          if (staticSections.length > 0) {
            result.prependSystemContext = assembleSections(staticSections);
          }

          // Dynamic context → prependContext (per-turn, changes with each prompt)
          if (dynamicSections.length > 0) {
            result.prependContext = assembleSections(dynamicSections);
          }

          const totalSections = staticSections.length + dynamicSections.length;
          api.logger.info(`[dot-ai] Injected: ${totalSections} sections (${staticSections.length} cached, ${dynamicSections.length} per-turn)`);

          return result;
        } catch (err) {
          api.logger.info(`[dot-ai] Pipeline error: ${err}`);
        }
        return;
      },
      { priority: 10 },
    );

    // ══════════════════════════════════════════════════════════════════════
    // Plugin Hook: agent_end — feed response back to runtime
    // ══════════════════════════════════════════════════════════════════════

    api.on('agent_end', async (_event, ctx) => {
      if (!cachedRuntime) return;
      const response = (ctx as { response?: string }).response ?? '';
      if (response) {
        await cachedRuntime.fire('agent_end', { response });
      }
    });

    // ══════════════════════════════════════════════════════════════════════
    // Service registration
    // ══════════════════════════════════════════════════════════════════════

    api.registerService({
      id: 'dot-ai',
      start: (svc) => svc.logger.info(`[dot-ai] Active (workspace: ${configuredWorkspace ?? 'cwd'})`),
      stop: (svc) => svc.logger.info('[dot-ai] Stopped'),
    });
  },
};

export default plugin;
