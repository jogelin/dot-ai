// dot-ai OpenClaw plugin
// Registers hooks for workspace convention enforcement and model routing
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { MODEL_ROUTING_CONTENT } from "./constants.js";

// Plugin definition following official OpenClaw SDK pattern
const plugin = {
  id: "dot-ai",
  name: "dot-ai — Universal AI Workspace Convention",
  version: "0.2.0",
  description: "Workspace convention with model routing and context enforcement",

  register(api: OpenClawPluginApi) {
    api.logger.info("[dot-ai] Plugin loaded");

    // --- Hook: before_agent_start ---
    // Injects full dot-ai SKILL.md + projects-index + model routing into prependContext
    api.on(
      "before_agent_start",
      async (_event, ctx) => {
        const workspaceDir = ctx.workspaceDir;
        if (!workspaceDir) {
          api.logger.info("[dot-ai] No workspaceDir in context, skipping");
          return;
        }

        // Resolve .ai/ directory
        const aiDir = path.basename(workspaceDir) === ".ai"
          ? workspaceDir
          : path.join(workspaceDir, ".ai");

        try {
          await fs.access(aiDir);
        } catch {
          api.logger.info(`[dot-ai] No .ai/ directory at ${workspaceDir}, skipping`);
          return;
        }

        const parts: string[] = [];

        // 1. Inject full SKILL.md
        const skillMdPath = path.join(aiDir, "skills", "dot-ai", "SKILL.md");
        try {
          const content = await fs.readFile(skillMdPath, "utf-8");
          parts.push("## dot-ai Convention (auto-injected)\n\n" + content);
          api.logger.info("[dot-ai] Injected SKILL.md");
        } catch (err) {
          api.logger.debug?.(`[dot-ai] SKILL.md not found: ${String(err)}`);
        }

        // 2. Inject projects-index.md for routing
        const projectsIndexPath = path.join(aiDir, "memory", "projects-index.md");
        try {
          const content = await fs.readFile(projectsIndexPath, "utf-8");
          parts.push("## Workspace Projects Index (auto-injected)\n\n" + content);
          api.logger.info("[dot-ai] Injected projects-index.md");
        } catch (err) {
          api.logger.debug?.(`[dot-ai] projects-index.md not found: ${String(err)}`);
        }

        // 3. Model routing rules
        parts.push(MODEL_ROUTING_CONTENT);

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
      start: (ctx) => {
        ctx.logger.info("[dot-ai] Workspace convention enforcement active");
      },
      stop: (ctx) => {
        ctx.logger.info("[dot-ai] Service stopped");
      },
    });
  },
};

export default plugin;
