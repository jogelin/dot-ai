// dot-ai OpenClaw plugin
// Registers hooks for workspace convention enforcement and model routing
import fs from "fs";
import path from "path";
import type { PluginAPI, HookEvent } from "./types";
import { DOT_AI_BOOTSTRAP_CONTENT, MODEL_ROUTING_CONTENT } from "./constants";

export const id = "dot-ai";
export const name = "dot-ai — Universal AI Workspace Convention";

export default function register(api: PluginAPI) {
  api.logger.info("[dot-ai] Plugin loaded");

  // --- Hook 1: agent:bootstrap (dot-ai-enforce) ---
  // Injects dot-ai convention context into bootstrapFiles
  api.registerHook(
    "agent:bootstrap",
    async (event: HookEvent) => {
      api.logger.info("[dot-ai] agent:bootstrap hook triggered (dot-ai-enforce)");

      const workspaceDir = event.context?.workspaceDir;
      if (!workspaceDir) {
        api.logger.info("[dot-ai] No workspaceDir in event context, skipping");
        return;
      }

      // Check if this is a dot-ai workspace (has .ai/ structure)
      // workspaceDir may be the .ai/ dir itself or its parent
      const aiDir = path.basename(workspaceDir) === ".ai"
        ? workspaceDir
        : path.join(workspaceDir, ".ai");
      const agentsFile = path.join(aiDir, "AGENTS.md");

      if (!fs.existsSync(aiDir)) {
        api.logger.info(`[dot-ai] No .ai/ directory at ${workspaceDir}, skipping`);
        return;
      }

      if (!fs.existsSync(agentsFile)) {
        api.logger.info(`[dot-ai] No AGENTS.md in .ai/, skipping dot-ai injection`);
        return;
      }

      api.logger.info("[dot-ai] dot-ai workspace detected, injecting conventions");

      // Inject the full dot-ai SKILL.md so the agent has the convention in context
      const skillMdPath = path.join(aiDir, "skills", "dot-ai", "SKILL.md");
      if (fs.existsSync(skillMdPath)) {
        try {
          const skillContent = fs.readFileSync(skillMdPath, "utf-8");
          event.context?.bootstrapFiles?.push({
            path: "dot-ai-skill",
            content: skillContent,
          });
          api.logger.info("[dot-ai] Injected full dot-ai SKILL.md into bootstrap");
        } catch (err) {
          api.logger.warn(`[dot-ai] Failed to read SKILL.md: ${err}`);
          // Fallback to summary
          event.context?.bootstrapFiles?.push({
            path: "dot-ai-bootstrap",
            content: DOT_AI_BOOTSTRAP_CONTENT,
          });
        }
      } else {
        api.logger.info("[dot-ai] No SKILL.md found, using summary bootstrap");
        event.context?.bootstrapFiles?.push({
          path: "dot-ai-bootstrap",
          content: DOT_AI_BOOTSTRAP_CONTENT,
        });
      }

      // Model routing rules
      event.context?.bootstrapFiles?.push({
        path: "model-routing-rules",
        content: MODEL_ROUTING_CONTENT,
      });

      // Inject projects-index.md for routing context
      const projectsIndexPath = path.join(aiDir, "memory", "projects-index.md");
      if (fs.existsSync(projectsIndexPath)) {
        try {
          const projectsIndex = fs.readFileSync(projectsIndexPath, "utf-8");
          event.context?.bootstrapFiles?.push({
            path: "projects-index",
            content: projectsIndex,
          });
          api.logger.info("[dot-ai] Injected projects-index.md for routing");
        } catch (err) {
          api.logger.warn(`[dot-ai] Failed to read projects-index.md: ${err}`);
        }
      } else {
        api.logger.info("[dot-ai] No projects-index.md found, skipping routing index injection");
      }
    },
    {
      name: "dot-ai-enforce",
      description: "Injects dot-ai workspace convention into agent bootstrap"
    }
  );

  // --- Service registration ---
  api.registerService({
    id: "dot-ai",
    start: () => {
      api.logger.info("[dot-ai] Workspace convention enforcement active");
    },
    stop: () => {
      api.logger.info("[dot-ai] Service stopped");
    },
  });
}
