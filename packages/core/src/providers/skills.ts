import fs from "node:fs/promises";
import path from "node:path";
import type { SkillRegistry, SkillMeta, ValidationResult } from "../index.js";

export class FileSkillRegistry implements SkillRegistry {
  constructor(private skillDirs: string[]) {}

  async discover(rootDir: string): Promise<SkillMeta[]> {
    const skills: SkillMeta[] = [];

    for (const dir of this.skillDirs) {
      const skillsDir = path.isAbsolute(dir)
        ? dir
        : path.join(rootDir, dir);
      try {
        const entries = await fs.readdir(skillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const skillPath = path.join(skillsDir, entry.name, "SKILL.md");
          try {
            const content = await fs.readFile(skillPath, "utf-8");
            const meta = this.parseFrontmatter(content, skillPath);
            if (meta) skills.push(meta);
          } catch {
            /* no SKILL.md */
          }
        }
      } catch {
        /* dir doesn't exist */
      }
    }

    return skills;
  }

  async get(name: string): Promise<string | null> {
    for (const dir of this.skillDirs) {
      const skillPath = path.join(dir, name, "SKILL.md");
      try {
        return await fs.readFile(skillPath, "utf-8");
      } catch {
        /* not in this dir */
      }
    }
    return null;
  }

  async validate(skillPath: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    let content: string;
    try {
      content = await fs.readFile(skillPath, "utf-8");
    } catch {
      return {
        valid: false,
        errors: [`File not found: ${skillPath}`],
        warnings: [],
      };
    }

    // Check frontmatter exists
    if (!content.startsWith("---")) {
      errors.push("Missing YAML frontmatter (must start with ---)");
    } else {
      const endIndex = content.indexOf("---", 3);
      if (endIndex === -1) {
        errors.push("Unclosed frontmatter (missing closing ---)");
      } else {
        const fm = content.slice(3, endIndex);
        if (!fm.includes("name:")) errors.push("Missing 'name' in frontmatter");
        if (!fm.includes("description:"))
          errors.push("Missing 'description' in frontmatter");
        if (!fm.includes("triggers:"))
          warnings.push("Missing 'triggers' in frontmatter");

        // Check description has "Use when" pattern
        const descMatch = fm.match(/description:\s*(.+)/);
        if (descMatch && !descMatch[1].toLowerCase().includes("use when")) {
          warnings.push(
            "Description should contain 'Use when...' for discoverability",
          );
        }
      }
    }

    // Check size
    const lines = content.split("\n").length;
    if (lines > 500)
      warnings.push(`Skill is ${lines} lines (max recommended: 500)`);

    return { valid: errors.length === 0, errors, warnings };
  }

  private parseFrontmatter(
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
}
