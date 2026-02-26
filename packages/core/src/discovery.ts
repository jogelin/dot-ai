import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceInfo, ProjectMeta, SkillMeta } from "./index.js";

/**
 * Discover .ai/ workspace structure.
 * Scans for projects (directories with .ai/ subdirs) and skills.
 */
export async function discoverWorkspace(
  rootDir: string,
): Promise<WorkspaceInfo> {
  const aiDir = path.join(rootDir, ".ai");

  // Discover projects
  const projects = await discoverProjects(rootDir);

  // Discover skills (root level)
  const skills = await discoverSkills(path.join(aiDir, "skills"));

  return { rootDir, projects, skills };
}

async function discoverProjects(rootDir: string): Promise<ProjectMeta[]> {
  const projects: ProjectMeta[] = [];

  // Scan common project locations
  for (const searchDir of ["projects", "apps", "libs", "packages"]) {
    const dir = path.join(rootDir, searchDir);
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const agentPath = path.join(dir, entry.name, ".ai", "AGENT.md");
        try {
          const content = await fs.readFile(agentPath, "utf-8");
          const meta = parseAgentFrontmatter(
            content,
            path.join(dir, entry.name),
          );
          if (meta) projects.push(meta);
        } catch {
          /* no .ai/AGENT.md */
        }
      }
    } catch {
      /* dir doesn't exist */
    }
  }

  return projects;
}

async function discoverSkills(skillsDir: string): Promise<SkillMeta[]> {
  const skills: SkillMeta[] = [];
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(skillsDir, entry.name, "SKILL.md");
      try {
        const content = await fs.readFile(skillPath, "utf-8");
        const meta = parseSkillFrontmatter(content, skillPath);
        if (meta) skills.push(meta);
      } catch {
        /* no SKILL.md */
      }
    }
  } catch {
    /* no skills dir */
  }
  return skills;
}

function parseAgentFrontmatter(
  content: string,
  projectPath: string,
): ProjectMeta | null {
  if (!content.startsWith("---")) return null;
  const endIndex = content.indexOf("---", 3);
  if (endIndex === -1) return null;

  const fm = content.slice(3, endIndex);
  const name =
    fm.match(/name:\s*(.+)/)?.[1]?.trim() || path.basename(projectPath);
  const description = fm.match(/description:\s*(.+)/)?.[1]?.trim() || "";
  const tagsMatch = fm.match(/tags:\s*\[([^\]]*)\]/);
  const tags = tagsMatch
    ? tagsMatch[1].split(",").map((t) => t.trim())
    : [];

  return { name, description, tags, path: projectPath };
}

function parseSkillFrontmatter(
  content: string,
  filePath: string,
): SkillMeta | null {
  if (!content.startsWith("---")) return null;
  const endIndex = content.indexOf("---", 3);
  if (endIndex === -1) return null;

  const fm = content.slice(3, endIndex);
  const name = fm.match(/name:\s*(.+)/)?.[1]?.trim() || "";
  const description = fm.match(/description:\s*(.+)/)?.[1]?.trim() || "";
  const triggersMatch = fm.match(/triggers:\s*\[([^\]]*)\]/);
  const triggers = triggersMatch
    ? triggersMatch[1].split(",").map((t) => t.trim())
    : [];

  if (!name) return null;
  return { name, description, triggers, path: filePath };
}
