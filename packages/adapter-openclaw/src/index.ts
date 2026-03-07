/**
 * dot-ai OpenClaw plugin v7
 *
 * Hooks into before_agent_start to run the full dot-ai pipeline via DotAiRuntime.
 * Uses the v7 extension-based pipeline — no providers required.
 * Returns enriched context as prependContext for the agent.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DotAiRuntime, formatSections } from '@dot-ai/core';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json') as { version: string };

// Inline OpenClaw plugin API types
interface OpenClawLogger {
  info(msg: string): void;
  debug?(msg: string): void;
}

interface OpenClawPluginApi {
  logger: OpenClawLogger;
  pluginConfig?: Record<string, unknown>;
  on(
    event: string,
    handler: (
      event: unknown,
      ctx: { workspaceDir?: string; sessionKey?: string; prompt?: string },
    ) => Promise<{ prependContext?: string } | void> | void,
    options?: { priority?: number },
  ): void;
  registerService(service: {
    id: string;
    start(ctx: { logger: OpenClawLogger }): void;
    stop(ctx: { logger: OpenClawLogger }): void;
  }): void;
  registerTool(tool: OpenClawTool | OpenClawToolFactory, opts?: { name?: string; names?: string[] }): void;
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

// Session-level cache
let cachedRuntime: DotAiRuntime | null = null;
let cachedWorkspace: string | null = null;

/**
 * Check if a directory contains a .ai/ workspace.
 */
function hasWorkspace(dir: string): boolean {
  return existsSync(join(dir, '.ai'));
}

const plugin = {
  id: 'dot-ai',
  name: 'dot-ai — Universal AI Workspace Convention',
  version: PKG_VERSION,
  description: 'Deterministic context enrichment for OpenClaw agents',
  kind: 'memory' as const,

  register(api: OpenClawPluginApi) {
    api.logger.info(`[dot-ai] Plugin loaded (v${PKG_VERSION})`);

    // Capture plugin config workspace for use in before_agent_start handler.
    // Set in openclaw.json: plugins.entries.dot-ai.config.workspace = "/path/to/project"
    const configuredWorkspace = api.pluginConfig?.workspace as string | undefined;
    if (configuredWorkspace) {
      api.logger.info(`[dot-ai] workspace from config: ${configuredWorkspace}`);
    }

    // Register tools from core capabilities (delegates to extensions)
    api.registerTool(
      (_ctx: Record<string, unknown>) => {
        if (!cachedRuntime?.isBooted) return null;
        const capabilities = cachedRuntime.capabilities;
        return capabilities.map((cap): OpenClawTool => ({
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

    // Hook: before_agent_start — run the full pipeline
    api.on(
      'before_agent_start',
      async (
        _event: unknown,
        ctx: { workspaceDir?: string; sessionKey?: string; prompt?: string },
      ) => {
        // Resolve workspace root with priority:
        // 1. cwd — if process.cwd() has .ai/ (Claude Code, Pi, local CLI)
        // 2. Plugin config (openclaw.json "dot-ai.workspace") — for gateway/Discord/TUI
        // 3. OpenClaw's ctx.workspaceDir — fallback
        const cwd = process.cwd();
        const cwdWorkspace = hasWorkspace(cwd) ? cwd : null;
        const rawWorkspaceDir = cwdWorkspace ?? configuredWorkspace ?? ctx.workspaceDir;

        if (!rawWorkspaceDir) {
          api.logger.info('[dot-ai] No workspaceRoot configured, no .ai/ in cwd, no workspaceDir — skipping');
          return;
        }

        // Strip trailing .ai/ if the path points to the .ai dir itself
        const workspaceDir = rawWorkspaceDir.endsWith('/.ai') || rawWorkspaceDir.endsWith('\\.ai')
          ? rawWorkspaceDir.slice(0, -4)
          : rawWorkspaceDir;

        const isSubagent = ctx.sessionKey?.includes(':subagent:') || ctx.sessionKey?.includes(':cron:');
        if (isSubagent) {
          api.logger.debug?.('[dot-ai] Sub-agent/cron session, skipping');
          return;
        }

        try {
          if (!cachedRuntime || cachedWorkspace !== workspaceDir) {
            api.logger.info(`[dot-ai] workspaceRoot=${workspaceDir}`);
            cachedRuntime = new DotAiRuntime({ workspaceRoot: workspaceDir });
            await cachedRuntime.boot();
            cachedWorkspace = workspaceDir;
            api.logger.info(`[dot-ai] Runtime booted (v${PKG_VERSION})`);

            // Log extension diagnostics
            const diag = cachedRuntime.diagnostics;
            api.logger.info(`[dot-ai] extensions=${diag.extensions.length}, capabilities=${diag.capabilityCount}`);
            if (diag.vocabularySize !== undefined) {
              api.logger.info(`[dot-ai] Vocabulary size: ${diag.vocabularySize}`);
            }
          }

          const prompt = ctx.prompt ?? '';
          const { sections } = await cachedRuntime.processPrompt(prompt);
          const formatted = formatSections(sections);

          if (formatted) {
            api.logger.info(`[dot-ai] Injected: ${sections.length} sections`);
            return { prependContext: formatted };
          }
        } catch (err) {
          api.logger.info(`[dot-ai] Pipeline error: ${err}`);
        }
        return;
      },
      { priority: 10 },
    );

    // Hook: after_agent_end — feed response back to runtime for learning + extension events
    api.on('after_agent_end', async (_event, ctx) => {
      if (!cachedRuntime) return;
      const response = (ctx as { response?: string }).response ?? '';
      if (response) {
        await cachedRuntime.fire('agent_end', { response });
      }
    });

    // Service registration
    api.registerService({
      id: 'dot-ai',
      start: (svc) => svc.logger.info(`[dot-ai] Active (workspace: ${configuredWorkspace ?? 'cwd'})`),
      stop: (svc) => svc.logger.info('[dot-ai] Stopped'),
    });
  },
};

export default plugin;
