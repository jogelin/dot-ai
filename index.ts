// dot-ai OpenClaw plugin
// Registers hooks for workspace convention enforcement and model routing
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// Plugin definition following official OpenClaw SDK pattern
const plugin = {
  id: "dot-ai",
  name: "dot-ai — Universal AI Workspace Convention",
  version: "0.2.0",
  description: "Workspace convention with model routing and context enforcement",

  register(api: OpenClawPluginApi) {
    api.logger.info("[dot-ai] Plugin loaded");

    // --- Hook: before_agent_start ---
    // Injects lightweight BOOTSTRAP.md + projects-index summary for minimal tokens
    api.on(
      "before_agent_start",
      async (_event: unknown, ctx: { workspaceDir?: string }) => {
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

        // 1. Inject lightweight BOOTSTRAP.md (~100 lines vs SKILL.md's 571 lines)
        const bootstrapPath = path.join(aiDir, "skills", "dot-ai", "BOOTSTRAP.md");
        try {
          const content = await fs.readFile(bootstrapPath, "utf-8");
          parts.push(content);
          api.logger.info("[dot-ai] Injected BOOTSTRAP.md (lightweight)");
        } catch (err) {
          // Fallback to full SKILL.md if BOOTSTRAP.md doesn't exist (backward compat)
          const skillMdPath = path.join(aiDir, "skills", "dot-ai", "SKILL.md");
          try {
            const content = await fs.readFile(skillMdPath, "utf-8");
            parts.push("## dot-ai Convention (auto-injected)\n\n" + content);
            api.logger.info("[dot-ai] Injected SKILL.md (BOOTSTRAP.md not found)");
          } catch {
            api.logger.debug?.(`[dot-ai] Neither BOOTSTRAP.md nor SKILL.md found`);
          }
        }

        // 2. Inject projects-index.md summary (just the table, not full content)
        const projectsIndexPath = path.join(aiDir, "memory", "projects-index.md");
        try {
          const content = await fs.readFile(projectsIndexPath, "utf-8");
          // Extract just the project table (lines between first | and last |)
          const lines = content.split("\n");
          const tableStart = lines.findIndex(l => l.trim().startsWith("|"));
          const tableEnd = lines.findLastIndex(l => l.trim().startsWith("|"));

          if (tableStart !== -1 && tableEnd !== -1) {
            const table = lines.slice(tableStart, tableEnd + 1).join("\n");
            parts.push("## Active Projects (auto-injected)\n\n" + table);
            api.logger.info("[dot-ai] Injected projects-index.md (table only)");
          } else {
            // No table found, inject full content as fallback
            parts.push("## Workspace Projects Index (auto-injected)\n\n" + content);
            api.logger.info("[dot-ai] Injected projects-index.md (full)");
          }
        } catch (err) {
          api.logger.debug?.(`[dot-ai] projects-index.md not found: ${String(err)}`);
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
      start: (ctx: { logger: { info: (msg: string) => void } }) => {
        ctx.logger.info("[dot-ai] Workspace convention enforcement active");
      },
      stop: (ctx: { logger: { info: (msg: string) => void } }) => {
        ctx.logger.info("[dot-ai] Service stopped");
      },
    });
  },
};

export default plugin;
