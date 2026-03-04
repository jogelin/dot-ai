/**
 * dot-ai OpenClaw plugin v4
 *
 * Hooks into before_agent_start to run the full dot-ai pipeline:
 * loadConfig → registerDefaults → createProviders → boot → enrich → formatContext
 *
 * Returns enriched context as prependContext for the agent.
 */
import {
  loadConfig,
  registerDefaults,
  registerProvider,
  createProviders,
  boot,
  enrich,
  injectRoot,
  formatContext,
  type Providers,
  type BootCache,
} from '@dot-ai/core';

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
let cachedProviders: Providers | null = null;
let cachedBoot: BootCache | null = null;
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

    // Register memory tools that delegate to dot-ai's memory provider
    api.registerTool(
      (_ctx: Record<string, unknown>) => {
        // Return tools that use cachedProviders (set in before_agent_start)
        const tools: OpenClawTool[] = [
          {
            name: 'memory_recall',
            label: 'Memory Recall',
            description: 'Search through memories managed by dot-ai. Use when you need context about prior work, decisions, preferences, or previously discussed topics.',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query' },
                limit: { type: 'number', description: 'Max results (default: 10)' },
              },
              required: ['query'],
            },
            async execute(_toolCallId: string, params: Record<string, unknown>) {
              if (!cachedProviders) {
                return { content: [{ type: 'text', text: 'Memory not initialized yet. Try again after first prompt.' }] };
              }
              const query = params.query as string;
              const limit = (params.limit as number) ?? 10;
              const results = await cachedProviders.memory.search(query);
              const limited = results.slice(0, limit);

              if (limited.length === 0) {
                return { content: [{ type: 'text', text: 'No relevant memories found.' }], details: { count: 0 } };
              }

              const text = limited.map((m, i) => `${i + 1}. ${m.content}${m.date ? ` (${m.date})` : ''}`).join('\n');
              const description = cachedProviders.memory.describe();
              return {
                content: [{ type: 'text', text: `${description}\n\nFound ${limited.length} memories:\n\n${text}` }],
                details: { count: limited.length, provider: description },
              };
            },
          },
          {
            name: 'memory_store',
            label: 'Memory Store',
            description: 'Save important information to dot-ai memory. Use for preferences, facts, decisions, patterns.',
            parameters: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'Information to remember' },
                type: { type: 'string', description: 'Memory type: fact, decision, log, pattern (default: log)' },
              },
              required: ['text'],
            },
            async execute(_toolCallId: string, params: Record<string, unknown>) {
              if (!cachedProviders) {
                return { content: [{ type: 'text', text: 'Memory not initialized yet.' }] };
              }
              const text = params.text as string;
              const type = (params.type as string) ?? 'log';
              await cachedProviders.memory.store({
                content: text,
                type,
                date: new Date().toISOString().slice(0, 10),
              });
              return {
                content: [{ type: 'text', text: `Stored: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"` }],
                details: { action: 'created' },
              };
            },
          },
        ];
        return tools;
      },
      { names: ['memory_recall', 'memory_store'] },
    );

    // Hook: before_agent_start — run the full pipeline
    api.on(
      'before_agent_start',
      async (
        _event: unknown,
        ctx: { workspaceDir?: string; sessionKey?: string; prompt?: string },
      ) => {
        // Ensure custom providers are registered before proceeding
        await providerPromise;

        const workspaceDir = ctx.workspaceDir;
        if (!workspaceDir) {
          api.logger.info('[dot-ai] No workspaceDir, skipping');
          return;
        }

        // Skip sub-agent/cron sessions
        const isSubagent = ctx.sessionKey?.includes(':subagent:') || ctx.sessionKey?.includes(':cron:');
        if (isSubagent) {
          api.logger.debug?.('[dot-ai] Sub-agent/cron session, skipping');
          return;
        }

        try {
          // Boot once per workspace (cache across prompts in same session)
          if (!cachedProviders || cachedWorkspace !== workspaceDir) {
            const rawConfig = await loadConfig(workspaceDir);

            // Inject workspaceDir into all provider options
            const config = injectRoot(rawConfig, workspaceDir);
            cachedProviders = await createProviders(config);
            cachedBoot = await boot(cachedProviders);
            cachedWorkspace = workspaceDir;
            api.logger.info(`[dot-ai] Booted: ${cachedBoot.identities.length} identities, ${cachedBoot.vocabulary.length} vocabulary, ${cachedBoot.skills.length} skills`);
          }

          // Enrich the prompt
          const prompt = ctx.prompt ?? '';
          const enriched = await enrich(prompt, cachedProviders, cachedBoot!);

          // Load skill content for matched skills
          for (const skill of enriched.skills) {
            if (!skill.content && skill.name) {
              skill.content = await cachedProviders.skills.load(skill.name) ?? undefined;
            }
          }

          // Format and inject
          const formatted = formatContext(enriched);
          if (formatted) {
            api.logger.info(`[dot-ai] Injected: ${enriched.identities.length} identities, ${enriched.memories.length} memories, ${enriched.recentTasks?.length ?? 0} tasks, ${enriched.skills.length} skills (${enriched.memoryDescription ?? 'unknown provider'})`);
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
