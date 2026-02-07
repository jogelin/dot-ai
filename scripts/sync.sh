#!/usr/bin/env bash
set -euo pipefail

# dot-ai sync — Configures non-plugin AI agents to use dot-ai conventions
#
# Usage:
#   bash sync.sh [workspace-root]
#
# IMPORTANT: This script is ONLY for agents WITHOUT native plugin systems:
#   - Cursor (uses .cursor/rules/)
#   - Codex (uses AGENTS.md)
#   - Continue.dev (uses .continuerc.json)
#
# OpenClaw and Claude Code use the native plugin system and don't need this script.
# Windsurf now has a plugin system - use that instead.
#
# What it does:
#   1. Detects the workspace root (or accepts it as argument)
#   2. Ensures .ai/ structure exists (creates AGENTS.md as convention file)
#   3. Ensures the skill is accessible at .ai/skills/dot-ai/ (symlinks if needed)
#   4. Injects boot reference into .ai/AGENTS.md (dot-ai convention file)
#   5. Updates existing non-plugin agent configs (Codex, Cursor)
#      — never creates agent-specific files that don't already exist

# Resolve the REAL physical location of this script (not the symlink path)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# The skill directory is either:
# - Same as SCRIPT_DIR if called from within skills/dot-ai/
# - ../skills/dot-ai/ if called from scripts/
if [[ -f "$SCRIPT_DIR/SKILL.md" ]]; then
  SKILL_DIR="$SCRIPT_DIR"
elif [[ -f "$SCRIPT_DIR/../skills/dot-ai/SKILL.md" ]]; then
  SKILL_DIR="$(cd "$SCRIPT_DIR/../skills/dot-ai" && pwd -P)"
else
  echo "❌ Could not locate dot-ai SKILL.md"
  echo "   Expected at: $SCRIPT_DIR/SKILL.md"
  echo "            or: $SCRIPT_DIR/../skills/dot-ai/SKILL.md"
  exit 1
fi

# ─── Workspace Root Detection ───────────────────────────────────────────────

find_workspace_root() {
  if [[ -n "${1:-}" ]]; then echo "$1"; return; fi

  # If invoked via a symlink inside a .ai/skills/ tree, derive root from there
  local call_path
  call_path="$(cd "$(dirname "$0")" && pwd)"
  if [[ "$call_path" == */.ai/skills/* ]]; then
    echo "${call_path%%/.ai/skills/*}"
    return
  fi

  # Walk up from cwd looking for .ai/
  local dir="$PWD"
  while [[ "$dir" != "/" ]]; do
    [[ -d "$dir/.ai" ]] && { echo "$dir"; return; }
    dir="$(dirname "$dir")"
  done

  echo "$PWD"
}

ROOT="$(find_workspace_root "${1:-}")"
MARKER_START="<!-- dot-ai start -->"
MARKER_END="<!-- dot-ai end -->"
# Relative path to SKILL.md from workspace root (always .ai/skills/dot-ai/SKILL.md)
SKILL_REL=".ai/skills/dot-ai/SKILL.md"

log() { echo "  $1"; }

# Check if python3 is available, fallback to simpler path computation
if command -v python3 &>/dev/null; then
  relpath() { python3 -c "import os; print(os.path.relpath('$1', '$ROOT'))"; }
else
  relpath() {
    # Fallback: simple prefix removal
    local path="$1"
    echo "${path#$ROOT/}"
  }
fi

# ─── Helpers ────────────────────────────────────────────────────────────────

inject_markers() {
  local file="$1"
  local content="$2"
  local block
  block=$(printf '%s\n%s\n%s' "$MARKER_START" "$content" "$MARKER_END")

  if [[ ! -f "$file" ]]; then
    mkdir -p "$(dirname "$file")"
    echo "$block" > "$file"
    log "✅ Created $(relpath "$file")"
    return
  fi

  if grep -q "dot-ai start" "$file" 2>/dev/null; then
    local tmp blockfile
    tmp=$(mktemp); blockfile=$(mktemp)
    echo "$block" > "$blockfile"
    awk '
      /dot-ai start/ { while((getline line < "'"$blockfile"'") > 0) print line; skip=1; next }
      /dot-ai end/ { skip=0; next }
      !skip { print }
    ' "$file" > "$tmp"
    mv "$tmp" "$file"; rm -f "$blockfile"
    log "🔄 Updated $(relpath "$file")"
  else
    printf '\n%s\n' "$block" >> "$file"
    log "➕ Appended to $(relpath "$file")"
  fi
}

# ─── Step 1: Ensure .ai/ structure ──────────────────────────────────────────

ensure_structure() {
  local created=0

  for dir in "$ROOT/.ai" "$ROOT/.ai/skills" "$ROOT/.ai/memory"; do
    if [[ ! -d "$dir" ]]; then
      mkdir -p "$dir"
      log "📁 Created $(relpath "$dir")/"
      created=1
    fi
  done

  # AGENTS.md is a dot-ai convention file — workspace operating rules.
  # Not agent-specific. Created as part of the .ai/ structure.
  if [[ ! -f "$ROOT/.ai/AGENTS.md" ]]; then
    cat > "$ROOT/.ai/AGENTS.md" << 'TMPL'
# AGENTS.md — Workspace Operating Rules

<!-- Add your workspace conventions, skills reference, and behavior rules here. -->
TMPL
    log "📄 Created .ai/AGENTS.md"
    created=1
  fi

  if [[ $created -eq 0 ]]; then
    log "✓ .ai/ structure exists"
  fi
}

# ─── Step 2: Ensure skill is at .ai/skills/dot-ai/ ─────────────────────────

ensure_skill_location() {
  local target="$ROOT/.ai/skills/dot-ai"

  # Already a symlink pointing to us?
  if [[ -L "$target" ]]; then
    local link_target
    link_target="$(readlink "$target")"
    [[ "$link_target" != /* ]] && link_target="$(cd "$(dirname "$target")" && cd "$(dirname "$link_target")" && pwd)/$(basename "$link_target")"
    if [[ "$link_target" == "$SKILL_DIR" ]]; then
      log "✓ Skill at .ai/skills/dot-ai/ → $SKILL_DIR"
      return
    fi
  fi

  # Already the actual directory?
  if [[ -d "$target" && ! -L "$target" && -f "$target/SKILL.md" ]]; then
    local resolved; resolved="$(cd "$target" && pwd -P)"
    [[ "$resolved" == "$SKILL_DIR" ]] && { log "✓ Skill at .ai/skills/dot-ai/"; return; }
  fi

  # Remove stale and create fresh symlink
  [[ -e "$target" || -L "$target" ]] && rm -rf "$target"
  ln -s "$SKILL_DIR" "$target"
  log "🔗 Linked .ai/skills/dot-ai/ → $SKILL_DIR"
}

# ─── Step 3: Inject boot ref into .ai/AGENTS.md ────────────────────────────

inject_boot_ref() {
  inject_markers "$ROOT/.ai/AGENTS.md" "<!-- Auto-managed by dot-ai. Do not edit between markers. -->
**Boot requirement:** Read and follow \`$SKILL_REL\` at every session start.
This skill defines the workspace convention (file structure, routing, memory, skills)."
}

# ─── Step 4: Update existing agent configs ──────────────────────────────────

sync_agents() {
  local synced=0

  # NOTE: Claude Code and OpenClaw use the native plugin system
  # and should NOT be synced via this script.
  # This script only handles agents WITHOUT plugin systems.

  # OpenAI Codex (AGENTS.md at repo root, distinct from .ai/AGENTS.md)
  if [[ -f "$ROOT/AGENTS.md" ]]; then
    inject_markers "$ROOT/AGENTS.md" "<!-- Auto-managed by dot-ai. Do not edit between markers. -->
Read and follow \`$SKILL_REL\` for workspace conventions."
    synced=$((synced + 1))
  fi

  # Cursor
  if [[ -d "$ROOT/.cursor" || -f "$ROOT/.cursorrules" ]]; then
    inject_markers "$ROOT/.cursor/rules/dot-ai.md" "# dot-ai workspace convention
Read and follow \`$SKILL_REL\` for workspace conventions."
    synced=$((synced + 1))
  fi

  # Windsurf (rules-based, no native plugin system)
  if [[ -d "$ROOT/.windsurf" || -f "$ROOT/.windsurfrules" ]]; then
    inject_markers "$ROOT/.windsurf/rules/dot-ai.md" "# dot-ai workspace convention
# Activation: Always On
Read and follow \`$SKILL_REL\` for workspace conventions."
    synced=$((synced + 1))
  fi

  # Continue.dev (if .continuerc.json exists)
  if [[ -f "$ROOT/.continuerc.json" ]]; then
    log "ℹ️  Continue.dev detected - add reference to $SKILL_REL manually in .continuerc.json"
  fi

  echo ""
  if [[ $synced -eq 0 ]]; then
    log "ℹ️  No agents requiring sync found (AGENTS.md, .cursor/, .windsurf/)"
    log "    OpenClaw/Claude Code → use plugin install"
  else
    log "✅ Updated $synced agent config(s)"
  fi
}

# ─── Main ───────────────────────────────────────────────────────────────────

echo "dot-ai sync"
echo "  Workspace: $ROOT"
echo "  Skill source: $SKILL_DIR"
echo ""

echo "📦 Structure"
ensure_structure
echo ""

echo "🔗 Skill location"
ensure_skill_location
echo ""

echo "📋 Boot reference"
inject_boot_ref
echo ""

echo "🤖 Agent configs (existing only)"
sync_agents
