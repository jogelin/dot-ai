/**
 * Bridge between @dot-ai/core and Claude Code hooks.
 *
 * Claude Code uses prompt-based hooks — the bridge generates
 * the boot prompt from core's boot sequence specification.
 */
import { existsSync } from "node:fs";
import { boot, type BootResult } from "@dot-ai/core";

/**
 * Generate the SessionStart hook prompt.
 * This replaces the hardcoded prompt in hooks.json with a dynamic one.
 */
export function generateBootPrompt(): string {
  return [
    "Check if this workspace has a .ai/ directory. If it does, execute the dot-ai boot sequence:",
    "(1) find root .ai/,",
    "(2) load AGENTS.md → SOUL.md → USER.md → IDENTITY.md → TOOLS.md,",
    "(3) load memory/YYYY-MM-DD.md for today and yesterday,",
    "(4) scan for projects and build workspace overview.",
    "Follow model-routing rules for all sub-agent spawns.",
    "If no .ai/ directory exists, skip the boot sequence entirely.",
  ].join(" ");
}

/**
 * Generate the SubagentStart hook prompt.
 */
export function generateRoutingPrompt(): string {
  return [
    "Before starting: check model-routing rules.",
    "Use haiku for execution/extraction tasks,",
    "sonnet for development/research,",
    "opus ONLY for complex reasoning.",
    "Never use the default model without checking.",
  ].join(" ");
}

/**
 * Check if oh-my-claudecode is present.
 * If OMC is detected, dot-ai defers orchestration to it.
 */
export function detectOMC(homeDir: string): boolean {
  try {
    return existsSync(`${homeDir}/.claude/.omc`);
  } catch {
    return false;
  }
}

export type { BootResult };
export { boot };
