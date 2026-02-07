// dot-ai OpenClaw plugin
// Registers hooks for workspace convention enforcement and model routing
import fs from "fs";
import path from "path";

export const id = "dot-ai";
export const name = "dot-ai — Universal AI Workspace Convention";

export default function register(api: any) {
  api.logger.info("[dot-ai] Plugin loaded");

  // --- Hook 1: agent:bootstrap (internal hook) ---
  // Injects dot-ai convention context into bootstrapFiles
  api.registerHook(
    "agent:bootstrap",
    async (event: any) => {
      api.logger.info("[dot-ai] agent:bootstrap hook triggered");

      const workspaceDir = event.context?.workspaceDir;
      if (!workspaceDir) {
        api.logger.info("[dot-ai] No workspaceDir in event context, skipping");
        return;
      }

      // Check if this is a dot-ai workspace
      const skillPath = path.join(workspaceDir, "skills", "dot-ai", "SKILL.md");
      if (!fs.existsSync(skillPath)) {
        api.logger.info(`[dot-ai] No dot-ai skill at ${skillPath}, skipping`);
        return;
      }

      api.logger.info("[dot-ai] Injecting workspace convention into bootstrap");

      event.context?.bootstrapFiles?.push({
        path: "dot-ai-bootstrap",
        content: [
          "## dot-ai Convention (auto-injected by plugin)",
          "",
          "This workspace follows the **dot-ai convention**.",
          "",
          "### Boot Sequence",
          "**You MUST output a boot log as your first message.** Follow the boot sequence in `skills/dot-ai/SKILL.md`.",
          "",
          "### Critical Rules (always active)",
          "- Read `skills/dot-ai/SKILL.md` for workspace structure, routing, and memory rules",
          "- Route every prompt through dot-ai (check `memory/projects-index.md`)",
          "- Use `dot-ai-tasks` for ALL task management",
          "- **data/ = structured exploitable data ONLY** (no research, no drafts)",
          "- Specify model in EVERY `sessions_spawn` (never leave default)",
        ].join("\n"),
      });

      // Model routing rules
      event.context?.bootstrapFiles?.push({
        path: "model-routing-rules",
        content: [
          "## Model Routing (auto-injected by plugin)",
          "",
          "BEFORE every `sessions_spawn`, select the right model:",
          "",
          "| Task Type | Model |",
          "|-----------|-------|",
          "| OCR, extraction, audit, bulk ops, scraping | **Haiku** (`anthropic/claude-haiku`) |",
          "| Dev, refactoring, code review, web research | **Sonnet** (`anthropic/claude-sonnet-4`) |",
          "| Complex reasoning, architecture, decisions | **Opus** (`anthropic/claude-opus-4-6`) |",
          "",
          "- ❌ NEVER spawn without specifying `model`",
          "- ❌ NEVER use Opus for execution tasks",
          "- ❌ NEVER do multiple web_fetch in Opus — delegate to Sonnet sub-agent",
        ].join("\n"),
      });
    },
    { name: "dot-ai-enforce", description: "Injects dot-ai workspace convention into agent bootstrap" }
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
