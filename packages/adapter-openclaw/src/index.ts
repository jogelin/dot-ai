/**
 * dot-ai OpenClaw plugin v4
 *
 * Hooks into before_agent_start to run the full dot-ai pipeline via DotAiRuntime.
 * Returns enriched context as prependContext for the agent.
 */
import {
  registerDefaults,
  registerProvider,
  DotAiRuntime,
} from '@dot-ai/core';
import { SqliteMemoryProvider } from '@dot-ai/provider-sqlite-memory';
import { FileIdentityProvider } from '@dot-ai/provider-file-identity';
import { FileSkillProvider } from '@dot-ai/provider-file-skills';
import { RulesRoutingProvider } from '@dot-ai/provider-rules-routing';
import { FileToolProvider } from '@dot-ai/provider-file-tools';

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

/**
 * Load custom providers declared in pluginConfig.
 * Workspaces declare custom providers via openclaw.json:
 *   plugins.entries.dot-ai.config.customProviders: [
 *     { type: "cockpit", module: "/abs/path/to/provider.ts" }
 *   ]
 */
async function loadCustomProviders(
  config: Record<string, unknown>,
  logger: OpenClawLogger,
): Promise<void> {
  const providers = config.customProviders;
  if (!Array.isArray(providers)) return;

  for (const entry of providers) {
    if (!entry || typeof entry !== 'object' || !('type' in entry) || !('module' in entry)) continue;

    const { type, module: modulePath } = entry as { type: string; module: string };
    try {
      const mod = await import(modulePath);
      // Find the exported provider class or factory
      for (const [name, exported] of Object.entries(mod)) {
        if (typeof exported === 'function') {
          if (name.endsWith('Provider')) {
            const ProviderClass = exported as new (opts: Record<string, unknown>) => unknown;
            registerProvider(`@custom/${type}`, (opts) => new ProviderClass(opts));
            logger.info(`[dot-ai] Registered custom provider: ${type} (${name})`);
            break;
          }
        }
      }
    } catch (err) {
      logger.info(`[dot-ai] Failed to load custom provider "${type}" from ${modulePath}: ${err}`);
    }
  }
}

// Session-level cache
let cachedRuntime: DotAiRuntime | null = null;
let cachedWorkspace: string | null = null;

const plugin = {
  id: 'dot-ai',
  name: 'dot-ai — Universal AI Workspace Convention',
  version: '0.4.0',
  description: 'Deterministic context enrichment for OpenClaw agents',
  kind: 'memory' as const,

  register(api: OpenClawPluginApi) {
    api.logger.info('[dot-ai] Plugin loaded (v4)');

    // Load custom providers if configured — capture the promise so before_agent_start can await it
    let providerPromise: Promise<void> = Promise.resolve();
    if (api.pluginConfig) {
      providerPromise = loadCustomProviders(api.pluginConfig, api.logger);
    }

    // Register default file-based providers
    registerDefaults();

    // Explicitly register sibling providers to bypass dynamic import resolution
    // issues when loaded via jiti in the OpenClaw gateway process.
    registerProvider('@dot-ai/provider-sqlite-memory', (opts) => new SqliteMemoryProvider(opts as Record<string, unknown>));
    registerProvider('@dot-ai/provider-file-identity', (opts) => new FileIdentityProvider(opts as Record<string, unknown>));
    registerProvider('@dot-ai/provider-file-skills', (opts) => new FileSkillProvider(opts as Record<string, unknown>));
    registerProvider('@dot-ai/provider-rules-routing', (opts) => new RulesRoutingProvider(opts as Record<string, unknown>));
    registerProvider('@dot-ai/provider-file-tools', (opts) => new FileToolProvider(opts as Record<string, unknown>));

    // Register tools from core capabilities (delegates to providers)
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
        await providerPromise;

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
            cachedRuntime = new DotAiRuntime({ workspaceRoot: workspaceDir, skipIdentities: true });
            await cachedRuntime.boot();
            cachedWorkspace = workspaceDir;
            api.logger.info('[dot-ai] Runtime booted');
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

    // Service registration
    api.registerService({
      id: 'dot-ai',
      start: (svc) => svc.logger.info('[dot-ai] Active'),
      stop: (svc) => svc.logger.info('[dot-ai] Stopped'),
    });
  },
};

export default plugin;
