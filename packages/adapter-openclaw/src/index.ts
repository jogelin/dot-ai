// dot-ai OpenClaw plugin
// Registers hooks for workspace convention enforcement and model routing
import fs from "node:fs/promises";
import path from "node:path";
import { registerTaskProvider } from "@dot-ai/core";
import { buildBootContext } from "./bridge.js";

// Inline OpenClaw plugin API types — avoids importing the full openclaw SDK as a hard dep
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
      ctx: { workspaceDir?: string; sessionKey?: string },
    ) => Promise<{ prependContext?: string } | void> | void,
    options?: { priority?: number },
  ): void;
  registerService(service: {
    id: string;
    start(ctx: { logger: OpenClawLogger }): void;
    stop(ctx: { logger: OpenClawLogger }): void;
  }): void;
}

/**
 * Load custom providers declared in pluginConfig.
 *
 * Workspaces declare custom providers via openclaw.json:
 *   plugins.entries.dot-ai.config.customProviders: [
 *     { type: "cockpit", module: "/abs/path/to/cockpit-tasks.ts" }
 *   ]
 *
 * Each module must export a class ending in *TaskProvider.
 * dot-ai knows nothing about the provider internals — it just
 * imports the module and registers what it exports.
 */
async function loadCustomProviders(
  config: Record<string, unknown>,
  logger: OpenClawLogger,
): Promise<void> {
  const providers = config.customProviders;
  if (!Array.isArray(providers)) return;

  for (const entry of providers) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("type" in entry) ||
      !("module" in entry)
    )
      continue;

    const { type, module: modulePath } = entry as {
      type: string;
      module: string;
    };

    try {
      const mod = await import(modulePath);

      // Find the *TaskProvider export
      for (const [name, exported] of Object.entries(mod)) {
        if (name.endsWith("TaskProvider") && typeof exported === "function") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ProviderClass = exported as new (opts: any) => any;
          registerTaskProvider(type, (cfg) => new ProviderClass(cfg));
          logger.info(`[dot-ai] Registered custom task provider: ${type} (${name})`);
          break;
        }
      }
    } catch (err) {
      logger.info(
        `[dot-ai] Failed to load custom provider "${type}" from ${modulePath}: ${err}`,
      );
    }
  }
}

// Plugin definition following official OpenClaw SDK pattern
const plugin = {
  id: "dot-ai",
  name: "dot-ai — Universal AI Workspace Convention",
  version: "0.3.0",
  description: "Workspace convention with model routing and context enforcement",

  register(api: OpenClawPluginApi) {
    api.logger.info("[dot-ai] Plugin loaded");

    // Load custom providers from pluginConfig (if any)
    if (api.pluginConfig) {
      void loadCustomProviders(api.pluginConfig, api.logger);
    }

    // --- Hook: before_agent_start ---
    // Injects BOOTSTRAP.md (convention rules) + workspace overview via core
    api.on(
      "before_agent_start",
      async (
        _event: unknown,
        ctx: { workspaceDir?: string; sessionKey?: string },
      ) => {
        const workspaceDir = ctx.workspaceDir;
        if (!workspaceDir) {
          api.logger.info("[dot-ai] No workspaceDir in context, skipping");
          return;
        }

        // Detect sub-agent sessions — inject minimal context only
        const isSubagent =
          ctx.sessionKey?.includes(":subagent:") ||
          ctx.sessionKey?.includes(":cron:");
        if (isSubagent) {
          api.logger.info(
            "[dot-ai] Sub-agent/cron session detected, skipping full bootstrap injection",
          );
          return;
        }

        // Resolve .ai/ directory
        const aiDir =
          path.basename(workspaceDir) === ".ai"
            ? workspaceDir
            : path.join(workspaceDir, ".ai");

        try {
          await fs.access(aiDir);
        } catch {
          api.logger.info(
            `[dot-ai] No .ai/ directory at ${workspaceDir}, skipping`,
          );
          return;
        }

        const parts: string[] = [];

        // 1. Inject BOOTSTRAP.md (convention rules, always needed)
        const bootstrapPath = path.join(
          aiDir,
          "skills",
          "dot-ai",
          "BOOTSTRAP.md",
        );
        try {
          const content = await fs.readFile(bootstrapPath, "utf-8");
          parts.push(content);
          api.logger.info("[dot-ai] Injected BOOTSTRAP.md");
        } catch {
          api.logger.debug?.(
            "[dot-ai] BOOTSTRAP.md not found, skipping",
          );
        }

        // 2. Use core's boot + discovery to build workspace overview
        const overview = await buildBootContext(workspaceDir);
        if (overview) {
          parts.push(overview);
          api.logger.info("[dot-ai] Injected workspace overview via @dot-ai/core");
        } else {
          api.logger.debug?.("[dot-ai] No workspace overview from core (no projects/skills found)");
        }

        // Only inject if we found workspace content
        if (parts.length === 0) return;

        return {
          prependContext: parts.join("\n\n---\n\n"),
        };
      },
      { priority: 10 },
    );

    // --- Service registration ---
    api.registerService({
      id: "dot-ai",
      start: (ctx: { logger: OpenClawLogger }) => {
        ctx.logger.info("[dot-ai] Workspace convention enforcement active");
      },
      stop: (ctx: { logger: OpenClawLogger }) => {
        ctx.logger.info("[dot-ai] Service stopped");
      },
    });
  },
};

export default plugin;
