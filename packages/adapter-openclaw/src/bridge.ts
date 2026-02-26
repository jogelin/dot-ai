/**
 * Bridge between @dot-ai/core and OpenClaw plugin API.
 *
 * OpenClaw handles model routing natively via its gateway config,
 * so the bridge is thin — mainly workspace service mapping.
 */
import { boot, type WorkspaceInfo } from "@dot-ai/core";

export async function buildBootContext(
  workspaceDir: string,
): Promise<string | null> {
  try {
    const result = await boot(workspaceDir);

    if (result.errors.length > 0 && result.coreContext.length === 0) {
      return null; // No .ai/ workspace found
    }

    const parts: string[] = [];

    // Inject compact workspace overview
    const { workspace } = result;
    if (workspace.projects.length > 0 || workspace.skills.length > 0) {
      parts.push(formatWorkspaceOverview(workspace));
    }

    return parts.length > 0 ? parts.join("\n\n---\n\n") : null;
  } catch {
    return null;
  }
}

function formatWorkspaceOverview(ws: WorkspaceInfo): string {
  const lines = ["## Workspace Overview (auto-injected)\n"];

  if (ws.projects.length > 0) {
    lines.push(`**${ws.projects.length} projects:**`);
    for (const p of ws.projects) {
      const tags = p.tags.length > 0 ? ` [${p.tags.join(", ")}]` : "";
      lines.push(`- **${p.name}**: ${p.description}${tags}`);
    }
  }

  if (ws.skills.length > 0) {
    lines.push(`\n**${ws.skills.length} skills available**`);
  }

  return lines.join("\n");
}
