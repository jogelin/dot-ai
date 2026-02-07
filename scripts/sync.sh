#!/usr/bin/env bash
set -euo pipefail

# dot-ai sync — Ensures the dot-ai skill is properly installed and
# all detected AI agents are configured to load it at boot.
#
# Usage:
#   bash sync.sh [workspace-root]
#
# What it does:
#   1. Detects the workspace root (or accepts it as argument)
#   2. Ensures .ai/ structure exists (creates AGENTS.md as convention file)
#   3. Ensures the skill is accessible at .ai/skills/dot-ai/ (symlinks if needed)
#   4. Injects boot reference into .ai/AGENTS.md (dot-ai convention file)
#   5. Updates existing agent configs (CLAUDE.md, Codex, Cursor, Windsurf)
#      — never creates agent-specific files that don't already exist

# Resolve the REAL physical location of this script (not the symlink path)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SKILL_FILE="$SCRIPT_DIR/SKILL.md"

if [[ ! -f "$SKILL_FILE" ]]; then
  echo "❌ SKILL.md not found at $SCRIPT_DIR"
  echo "   sync.sh must be run from the dot-ai skill directory."
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
relpath() { python3 -c "import os; print(os.path.relpath('$1', '$ROOT'))"; }

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
    if [[ "$link_target" == "$SCRIPT_DIR" ]]; then
      log "✓ Skill at .ai/skills/dot-ai/ → $SCRIPT_DIR"
      return
    fi
  fi

  # Already the actual directory?
  if [[ -d "$target" && ! -L "$target" && -f "$target/SKILL.md" ]]; then
    local resolved; resolved="$(cd "$target" && pwd -P)"
    [[ "$resolved" == "$SCRIPT_DIR" ]] && { log "✓ Skill at .ai/skills/dot-ai/"; return; }
  fi

  # Remove stale and create fresh symlink
  [[ -e "$target" || -L "$target" ]] && rm -rf "$target"
  ln -s "$SCRIPT_DIR" "$target"
  log "🔗 Linked .ai/skills/dot-ai/ → $SCRIPT_DIR"
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

  # Claude Code
  if [[ -f "$ROOT/CLAUDE.md" ]]; then
    inject_markers "$ROOT/CLAUDE.md" "<!-- Auto-managed by dot-ai. Do not edit between markers. -->
@$SKILL_REL"
    synced=$((synced + 1))
  fi

  # OpenAI Codex (AGENTS.md at repo root, distinct from .ai/AGENTS.md)
  if [[ -f "$ROOT/AGENTS.md" ]]; then
    inject_markers "$ROOT/AGENTS.md" "<!-- Auto-managed by dot-ai. Do not edit between markers. -->
Read and follow \`$SKILL_REL\` for workspace conventions."
    synced=$((synced + 1))
  fi

  # Windsurf
  if [[ -d "$ROOT/.windsurf" || -f "$ROOT/.windsurfrules" ]]; then
    inject_markers "$ROOT/.windsurf/rules/dot-ai.md" "# dot-ai workspace convention
# Activation: Always On
Read and follow \`$SKILL_REL\` for workspace conventions."
    synced=$((synced + 1))
  fi

  # Cursor
  if [[ -d "$ROOT/.cursor" || -f "$ROOT/.cursorrules" ]]; then
    inject_markers "$ROOT/.cursor/rules/dot-ai.md" "# dot-ai workspace convention
Read and follow \`$SKILL_REL\` for workspace conventions."
    synced=$((synced + 1))
  fi

  echo ""
  if [[ $synced -eq 0 ]]; then
    log "ℹ️  No external agent configs found (CLAUDE.md, AGENTS.md, .cursor/, .windsurf/)"
  else
    log "✅ Updated $synced agent config(s)"
  fi
}

# ─── Main ───────────────────────────────────────────────────────────────────

echo "dot-ai sync"
echo "  Workspace: $ROOT"
echo "  Skill source: $SCRIPT_DIR"
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
