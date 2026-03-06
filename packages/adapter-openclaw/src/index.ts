/**
 * dot-ai OpenClaw plugin v6
 *
 * Hooks into before_agent_start to run the full dot-ai pipeline via DotAiRuntime.
 * Uses the v6 extension-based pipeline — no providers required.
 * Returns enriched context as prependContext for the agent.
 */
import { DotAiRuntime } from '@dot-ai/core';

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

const plugin = {
  id: 'dot-ai',
  name: 'dot-ai — Universal AI Workspace Convention',
  version: '6.0.0',
  description: 'Deterministic context enrichment for OpenClaw agents',
  kind: 'memory' as const,

  register(api: OpenClawPluginApi) {
    api.logger.info('[dot-ai] Plugin loaded (v6)');

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
        const workspaceDir = ctx.workspaceDir;
        if (!workspaceDir) {
          api.logger.info('[dot-ai] No workspaceDir, skipping');
          return;
        }

        const isSubagent = ctx.sessionKey?.includes(':subagent:') || ctx.sessionKey?.includes(':cron:');
        if (isSubagent) {
          api.logger.debug?.('[dot-ai] Sub-agent/cron session, skipping');
          return;
        }

        try {
          if (!cachedRuntime || cachedWorkspace !== workspaceDir) {
            cachedRuntime = new DotAiRuntime({ workspaceRoot: workspaceDir });
            await cachedRuntime.boot();
            cachedWorkspace = workspaceDir;
            api.logger.info('[dot-ai] Runtime booted (v6)');

            // Log extension diagnostics
            const diag = cachedRuntime.diagnostics;
            api.logger.info(`[dot-ai] v6=${diag.v6}, extensions=${diag.extensions.length}, capabilities=${diag.capabilityCount}`);
            if (diag.vocabularySize !== undefined) {
              api.logger.info(`[dot-ai] Vocabulary size: ${diag.vocabularySize}`);
            }
          }

          const prompt = ctx.prompt ?? '';
          const { formatted, enriched } = await cachedRuntime.processPrompt(prompt);

          if (formatted) {
            api.logger.info(`[dot-ai] Injected: ${enriched.identities.length} ids, ${enriched.memories.length} mems, ${enriched.skills.length} skills`);
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
        await cachedRuntime.learn(response);
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
