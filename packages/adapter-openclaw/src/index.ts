/**
 * dot-ai OpenClaw plugin v7
 *
 * Hooks into before_agent_start to run the full dot-ai pipeline via DotAiRuntime.
 * Uses the v7 extension-based pipeline — no providers required.
 * Returns enriched context as prependContext for the agent.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
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
 * Find workspace root by walking up from a starting directory looking for .ai/.
 * Returns the directory containing .ai/, or null if not found.
 */
function findWorkspaceRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, '.ai'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return null;
}

const plugin = {
  id: 'dot-ai',
  name: 'dot-ai — Universal AI Workspace Convention',
  version: PKG_VERSION,
  description: 'Deterministic context enrichment for OpenClaw agents',
  kind: 'memory' as const,

  register(api: OpenClawPluginApi) {
    api.logger.info(`[dot-ai] Plugin loaded (v${PKG_VERSION})`);

    // Resolve workspace root from plugin config (set once in openclaw.json)
    // This is the primary way to configure the workspace for gateway/Discord/TUI
    // where process.cwd() is not the user's project directory.
    const configuredWorkspaceRoot = api.pluginConfig?.workspaceRoot as string | undefined;
    if (configuredWorkspaceRoot) {
      api.logger.info(`[dot-ai] workspaceRoot from config: ${configuredWorkspaceRoot}`);
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
        // 1. Plugin config (openclaw.json "dot-ai.workspaceRoot") — for gateway/Discord/TUI
        // 2. cwd detection (walk up looking for .ai/) — for local CLI usage
        // 3. OpenClaw's ctx.workspaceDir — fallback
        const cwdWorkspace = findWorkspaceRoot(process.cwd());
        const rawWorkspaceDir = configuredWorkspaceRoot ?? cwdWorkspace ?? ctx.workspaceDir;

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
      start: (svc) => svc.logger.info('[dot-ai] Active'),
      stop: (svc) => svc.logger.info('[dot-ai] Stopped'),
    });
  },
};

export default plugin;
