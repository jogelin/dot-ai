// dot-ai enforce hook — injects workspace convention at agent:bootstrap
import path from "path";
import fs from "fs";
import type { HookEvent, HookHandler } from "../../types";
import { DOT_AI_BOOTSTRAP_CONTENT } from "../../constants";

const handler: HookHandler = async (event: HookEvent) => {
  if (event.type !== "agent" || event.action !== "bootstrap") {
    return;
  }

  const workspaceDir = event.context?.workspaceDir;
  if (!workspaceDir) return;

  // Check if this is a dot-ai workspace (has .ai/ structure)
  const aiDir = path.join(workspaceDir, ".ai");
  const agentsFile = path.join(aiDir, "AGENTS.md");

  if (!fs.existsSync(aiDir) || !fs.existsSync(agentsFile)) {
    return; // Not a dot-ai workspace, skip
  }

  // Inject dot-ai bootstrap context
  event.context?.bootstrapFiles?.push({
    path: "dot-ai-bootstrap",
    content: DOT_AI_BOOTSTRAP_CONTENT,
  });
};

export default handler;
