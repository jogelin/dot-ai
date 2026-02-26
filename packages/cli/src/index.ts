#!/usr/bin/env node
/**
 * @dot-ai/cli — Universal workspace management
 */
import { discoverWorkspace, validateWorkspace, boot, FileSkillRegistry } from "@dot-ai/core";
import path from "node:path";
import fs from "node:fs/promises";

const command = process.argv[2];
const cwd = process.cwd();

async function findAiRoot(dir: string): Promise<string | null> {
  let current = dir;
  while (current !== path.dirname(current)) {
    try {
      await fs.access(path.join(current, ".ai"));
      return current;
    } catch {
      current = path.dirname(current);
    }
  }
  return null;
}

async function cmdInit() {
  const aiDir = path.join(cwd, ".ai");
  try {
    await fs.access(aiDir);
    console.log("⚠️  .ai/ already exists");
    return;
  } catch { /* doesn't exist, good */ }

  // Create minimal structure
  await fs.mkdir(path.join(aiDir, "memory"), { recursive: true });
  await fs.mkdir(path.join(aiDir, "skills"), { recursive: true });

  await fs.writeFile(path.join(aiDir, "AGENTS.md"), `# AGENTS.md\n\nOperating rules for this workspace.\n`);
  await fs.writeFile(path.join(aiDir, "SOUL.md"), `# SOUL.md\n\nPersonality and tone.\n`);
  await fs.writeFile(path.join(aiDir, "USER.md"), `# USER.md\n\nAbout the human.\n`);
  await fs.writeFile(path.join(aiDir, "IDENTITY.md"), `# IDENTITY.md\n\n- **Name:** (your AI's name)\n- **Emoji:** 🤖\n`);
  await fs.writeFile(path.join(aiDir, "TOOLS.md"), `# TOOLS.md\n\nTools and integrations.\n`);

  console.log("✅ Created .ai/ workspace");
  console.log("   Edit the files to customize your workspace.");
}

async function cmdScan() {
  const root = await findAiRoot(cwd);
  if (!root) { console.error("❌ No .ai/ directory found"); process.exit(1); }

  const ws = await discoverWorkspace(root);

  // Generate projects-index.md
  const lines = ["# Projects Index\n", "| Project | Description | Tags |", "|---------|-------------|------|"];
  for (const p of ws.projects) {
    lines.push(`| ${p.name} | ${p.description} | ${p.tags.join(", ")} |`);
  }

  const indexPath = path.join(root, ".ai", "memory", "projects-index.md");
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, lines.join("\n") + "\n");

  console.log(`✅ Scanned workspace: ${ws.projects.length} projects, ${ws.skills.length} skills`);
  console.log(`   Updated: .ai/memory/projects-index.md`);
}

async function cmdDoctor() {
  const root = await findAiRoot(cwd);
  if (!root) { console.error("❌ No .ai/ directory found"); process.exit(1); }

  const result = await validateWorkspace(root);

  if (result.errors.length === 0 && result.warnings.length === 0) {
    console.log("✅ Workspace is healthy");
    return;
  }

  for (const err of result.errors) {
    console.log(`❌ ${err}`);
  }
  for (const warn of result.warnings) {
    console.log(`⚠️  ${warn}`);
  }

  console.log(`\n${result.valid ? "⚠️  Warnings found" : "❌ Issues found"} (${result.errors.length} errors, ${result.warnings.length} warnings)`);
  process.exit(result.valid ? 0 : 1);
}

async function cmdAudit() {
  const root = await findAiRoot(cwd);
  if (!root) { console.error("❌ No .ai/ directory found"); process.exit(1); }

  console.log("🔍 Running workspace audit...\n");

  // Validate workspace structure
  const validation = await validateWorkspace(root);

  // Validate all skills
  const skillsDir = path.join(root, ".ai", "skills");
  const registry = new FileSkillRegistry([skillsDir]);
  const skills = await registry.discover(root);

  let skillWarnings = 0;
  let skillErrors = 0;
  for (const skill of skills) {
    const result = await registry.validate(skill.path);
    if (!result.valid) {
      skillErrors++;
      for (const err of result.errors) console.log(`❌ ${skill.name}: ${err}`);
    }
    for (const warn of result.warnings) {
      skillWarnings++;
      console.log(`⚠️  ${skill.name}: ${warn}`);
    }
  }

  // Boot sequence test
  const bootResult = await boot(root);

  // Summary
  console.log(`\n📊 Audit Summary`);
  console.log(`   Structure: ${validation.errors.length} errors, ${validation.warnings.length} warnings`);
  console.log(`   Skills: ${skills.length} found, ${skillErrors} invalid, ${skillWarnings} warnings`);
  console.log(`   Boot: ${bootResult.errors.length} issues`);
  console.log(`   Projects: ${bootResult.workspace.projects.length} discovered`);

  const totalErrors = validation.errors.length + skillErrors + bootResult.errors.length;
  if (totalErrors === 0) {
    console.log("\n✅ Workspace is clean");
  } else {
    console.log(`\n❌ ${totalErrors} issues need attention`);
    process.exit(1);
  }
}

switch (command) {
  case "init": cmdInit(); break;
  case "scan": cmdScan(); break;
  case "doctor": cmdDoctor(); break;
  case "audit": cmdAudit(); break;
  case "--version": console.log("0.3.0"); break;
  case "--help":
  default:
    console.log("dot-ai — Universal AI workspace management\n");
    console.log("Commands:");
    console.log("  init     Scaffold .ai/ workspace from templates");
    console.log("  scan     Regenerate workspace indexes");
    console.log("  doctor   Validate workspace health");
    console.log("  audit    Run full convention audit");
    console.log("\nOptions:");
    console.log("  --version  Show version");
    console.log("  --help     Show this help");
    if (!command || command === "--help") process.exit(0);
    else process.exit(1);
}
