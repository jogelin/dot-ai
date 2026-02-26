import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceInfo } from "./index.js";
import { discoverWorkspace } from "./discovery.js";

export interface BootResult {
  workspace: WorkspaceInfo;
  coreContext: string[];
  sessionContext: string[];
  errors: string[];
}

const CORE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "USER.md",
  "IDENTITY.md",
  "TOOLS.md",
];

/**
 * Execute the dot-ai boot sequence.
 *
 * Phase 1: Load root context (AGENTS, SOUL, USER, IDENTITY, TOOLS)
 * Phase 2: Load session context (today + yesterday memory, projects-index)
 * Phase 3: Discover workspace (projects, skills)
 */
export async function boot(rootDir: string): Promise<BootResult> {
  const aiDir = path.join(rootDir, ".ai");
  const errors: string[] = [];

  // Phase 1: Core context
  const coreContext: string[] = [];
  for (const file of CORE_FILES) {
    const filePath = path.join(aiDir, file);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      coreContext.push(content);
    } catch {
      if (file === "AGENTS.md" || file === "SOUL.md") {
        errors.push(`Missing required file: ${file}`);
      }
    }
  }

  // Phase 2: Session context
  const sessionContext: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000)
    .toISOString()
    .slice(0, 10);

  for (const date of [today, yesterday]) {
    const dailyPath = path.join(aiDir, "memory", `${date}.md`);
    try {
      const content = await fs.readFile(dailyPath, "utf-8");
      sessionContext.push(content);
    } catch {
      /* no daily note for this date */
    }
  }

  // Load projects-index
  const indexPath = path.join(aiDir, "memory", "projects-index.md");
  try {
    const content = await fs.readFile(indexPath, "utf-8");
    sessionContext.push(content);
  } catch {
    errors.push("projects-index.md not found — run 'dot-ai scan' to generate");
  }

  // Phase 3: Discover workspace
  const workspace = await discoverWorkspace(rootDir);

  return { workspace, coreContext, sessionContext, errors };
}
