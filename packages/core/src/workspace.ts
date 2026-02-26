import fs from "node:fs/promises";
import path from "node:path";
import type { ValidationResult } from "./index.js";

const REQUIRED_ROOT_FILES = ["AGENTS.md"];
const RECOMMENDED_ROOT_FILES = ["SOUL.md", "USER.md", "IDENTITY.md", "TOOLS.md"];
const FORBIDDEN_PROJECT_FILES = ["SOUL.md", "USER.md", "IDENTITY.md"];

/**
 * Validate a .ai/ workspace structure.
 */
export async function validateWorkspace(
  rootDir: string,
): Promise<ValidationResult> {
  const aiDir = path.join(rootDir, ".ai");
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check .ai/ exists
  try {
    await fs.access(aiDir);
  } catch {
    return { valid: false, errors: [".ai/ directory not found"], warnings: [] };
  }

  // Check required root files
  for (const file of REQUIRED_ROOT_FILES) {
    try {
      await fs.access(path.join(aiDir, file));
    } catch {
      errors.push(`Missing required file: .ai/${file}`);
    }
  }

  // Check recommended root files
  for (const file of RECOMMENDED_ROOT_FILES) {
    try {
      await fs.access(path.join(aiDir, file));
    } catch {
      warnings.push(`Missing recommended file: .ai/${file}`);
    }
  }

  // Check projects don't have forbidden files (identity should be inherited)
  const projectDirs = ["projects", "apps", "libs", "packages"];
  for (const pd of projectDirs) {
    const dir = path.join(rootDir, pd);
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const projectAi = path.join(dir, entry.name, ".ai");
        try {
          await fs.access(projectAi);
          // Project has .ai/ — check for forbidden files
          for (const forbidden of FORBIDDEN_PROJECT_FILES) {
            try {
              await fs.access(path.join(projectAi, forbidden));
              warnings.push(
                `${entry.name}/.ai/${forbidden} should not exist (inherited from root)`,
              );
            } catch {
              /* good, doesn't exist */
            }
          }
          // Check AGENT.md exists
          try {
            await fs.access(path.join(projectAi, "AGENT.md"));
          } catch {
            errors.push(
              `${entry.name}/.ai/ exists but missing AGENT.md (required)`,
            );
          }
        } catch {
          /* no .ai/ in this project */
        }
      }
    } catch {
      /* project dir doesn't exist */
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
