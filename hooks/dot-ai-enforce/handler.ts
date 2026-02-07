// dot-ai enforce hook — injects workspace convention at agent:bootstrap
import path from "path";
import fs from "fs";

interface HookEvent {
  type: string;
  action: string;
  context?: {
    workspaceDir?: string;
    bootstrapFiles?: Array<{ path: string; content: string }>;
  };
  messages: string[];
}

const handler = async (event: HookEvent) => {
  if (event.type !== "agent" || event.action !== "bootstrap") {
    return;
  }

  const workspaceDir = event.context?.workspaceDir;
  if (!workspaceDir) return;

  // Check if this is a dot-ai workspace
  const skillPath = path.join(workspaceDir, "skills", "dot-ai", "SKILL.md");
  if (!fs.existsSync(skillPath)) {
    return; // Not a dot-ai workspace, skip
  }

  // Inject dot-ai bootstrap context
  event.context?.bootstrapFiles?.push({
    path: "dot-ai-bootstrap",
    content: [
      "## dot-ai Convention (auto-injected by plugin)",
      "",
      "This workspace follows the **dot-ai convention**.",
      "",
      "### Critical Rules (always active)",
      "- Read `skills/dot-ai/SKILL.md` for workspace structure, routing, and memory rules",
      "- Read `skills/model-routing/SKILL.md` for model selection rules",
      "- Route every prompt through dot-ai (check `memory/projects-index.md`)",
      "- Use `dot-ai-tasks` for ALL task management:",
      "  - BACKLOG.md = index (lightweight)",
      "  - tasks/<slug>.md = details (on-demand)",
      "  - Project tasks → `projects/<name>/.ai/memory/tasks/`",
      "  - Cross-project tasks → `.ai/memory/tasks/`",
      "- **data/ = structured exploitable data ONLY** (no research, no drafts, no OCR)",
      "- Research outputs → linked to tasks in `.ai/memory/tasks/`",
      "- Specify model in EVERY `sessions_spawn` (never leave default)",
    ].join("\n"),
  });
};

export default handler;
