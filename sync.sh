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
#   2. Ensures .ai/ structure exists (creates if needed)
#   3. Ensures the skill is accessible at .ai/skills/dot-ai/ (symlinks if needed)
#   4. Injects boot references into all detected agent configs

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
  # Explicit argument takes priority
  if [[ -n "${1:-}" ]]; then
    echo "$1"
    return
  fi

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
    if [[ -d "$dir/.ai" ]]; then
      echo "$dir"
      return
    fi
    dir="$(dirname "$dir")"
  done

  # No .ai/ found — use cwd (will be created)
  echo "$PWD"
}

ROOT="$(find_workspace_root "${1:-}")"

MARKER_START="<!-- dot-ai start -->"
MARKER_END="<!-- dot-ai end -->"

log() { echo "  $1"; }

# ─── Step 1: Ensure .ai/ structure ──────────────────────────────────────────

ensure_ai_structure() {
  local created=0

  if [[ ! -d "$ROOT/.ai" ]]; then
    mkdir -p "$ROOT/.ai"
    log "📁 Created .ai/"
    created=1
  fi

  # Core directories
  for dir in skills memory; do
    if [[ ! -d "$ROOT/.ai/$dir" ]]; then
      mkdir -p "$ROOT/.ai/$dir"
      log "📁 Created .ai/$dir/"
      created=1
    fi
  done

  if [[ $created -eq 0 ]]; then
    log "✓ .ai/ structure exists"
  fi
}

# ─── Step 2: Ensure skill is at .ai/skills/dot-ai/ ─────────────────────────

ensure_skill_location() {
  local target="$ROOT/.ai/skills/dot-ai"

  # If it's a symlink, check where it points
  if [[ -L "$target" ]]; then
    local link_target
    link_target="$(readlink "$target")"
    # Resolve to absolute
    if [[ "$link_target" != /* ]]; then
      link_target="$(cd "$(dirname "$target")" && cd "$(dirname "$link_target")" && pwd)/$(basename "$link_target")"
    fi
    if [[ "$link_target" == "$SCRIPT_DIR" ]]; then
      log "✓ Skill already at .ai/skills/dot-ai/ → $SCRIPT_DIR"
      return
    fi
  fi

  # If it's the actual directory (not a symlink) and contains our SKILL.md
  if [[ -d "$target" ]] && [[ ! -L "$target" ]] && [[ -f "$target/SKILL.md" ]]; then
    local resolved
    resolved="$(cd "$target" && pwd -P)"
    if [[ "$resolved" == "$SCRIPT_DIR" ]]; then
      log "✓ Skill already at .ai/skills/dot-ai/"
      return
    fi
  fi

  # Remove stale link or dir, create fresh symlink
  if [[ -e "$target" ]] || [[ -L "$target" ]]; then
    rm -rf "$target"
  fi

  ln -s "$SCRIPT_DIR" "$target"
  log "🔗 Linked .ai/skills/dot-ai/ → $SCRIPT_DIR"
}

# ─── Step 3: Inject agent configs ───────────────────────────────────────────

# Compute the relative path from workspace root to SKILL.md
SKILL_REL="$(python3 -c "import os; print(os.path.relpath('$ROOT/.ai/skills/dot-ai/SKILL.md', '$ROOT'))")"

inject_markers() {
  local file="$1"
  local content="$2"
  local block
  block=$(printf '%s\n%s\n%s' "$MARKER_START" "$content" "$MARKER_END")

  if [[ ! -f "$file" ]]; then
    mkdir -p "$(dirname "$file")"
    echo "$block" > "$file"
    log "✅ Created $(python3 -c "import os; print(os.path.relpath('$file', '$ROOT'))")"
    return
  fi

  if grep -q "dot-ai start" "$file" 2>/dev/null; then
    local tmp blockfile
    tmp=$(mktemp)
    blockfile=$(mktemp)
    echo "$block" > "$blockfile"
    awk '
      /dot-ai start/ { while((getline line < "'"$blockfile"'") > 0) print line; skip=1; next }
      /dot-ai end/ { skip=0; next }
      !skip { print }
    ' "$file" > "$tmp"
    mv "$tmp" "$file"
    rm -f "$blockfile"
    log "🔄 Updated $(python3 -c "import os; print(os.path.relpath('$file', '$ROOT'))")"
  else
    echo "" >> "$file"
    echo "$block" >> "$file"
    log "➕ Appended to $(python3 -c "import os; print(os.path.relpath('$file', '$ROOT'))")"
  fi
}

sync_agents() {
  local synced=0

  # Only update agent configs that already exist in the project.
  # sync.sh does NOT create new agent configs — the user sets up their agents first.

  # --- Claude Code ---
  if [[ -f "$ROOT/CLAUDE.md" ]]; then
    inject_markers "$ROOT/CLAUDE.md" "<!-- Auto-managed by dot-ai. Do not edit between markers. -->
@$SKILL_REL"
    synced=$((synced + 1))
  fi

  # --- OpenClaw ---
  if [[ -f "$ROOT/.ai/AGENTS.md" ]]; then
    inject_markers "$ROOT/.ai/AGENTS.md" "<!-- Auto-managed by dot-ai. Do not edit between markers. -->
**Boot requirement:** Read and follow \`$SKILL_REL\` at every session start.
This skill defines the workspace convention (file structure, routing, memory, skills)."
    synced=$((synced + 1))
  fi

  # --- OpenAI Codex ---
  if [[ -f "$ROOT/AGENTS.md" ]]; then
    inject_markers "$ROOT/AGENTS.md" "<!-- Auto-managed by dot-ai. Do not edit between markers. -->
Read and follow \`$SKILL_REL\` for workspace conventions."
    synced=$((synced + 1))
  fi

  # --- Windsurf ---
  if [[ -d "$ROOT/.windsurf" ]] || [[ -f "$ROOT/.windsurfrules" ]]; then
    inject_markers "$ROOT/.windsurf/rules/dot-ai.md" "# dot-ai workspace convention
# Activation: Always On
Read and follow \`$SKILL_REL\` for workspace conventions."
    synced=$((synced + 1))
  fi

  # --- Cursor ---
  if [[ -d "$ROOT/.cursor" ]] || [[ -f "$ROOT/.cursorrules" ]]; then
    inject_markers "$ROOT/.cursor/rules/dot-ai.md" "# dot-ai workspace convention
Read and follow \`$SKILL_REL\` for workspace conventions."
    synced=$((synced + 1))
  fi

  echo ""
  if [[ $synced -eq 0 ]]; then
    echo "  ⚠️  No AI agents detected. Configs will be created when you install an agent."
  else
    echo "  ✅ Synced $synced agent(s)"
  fi
}

# ─── Main ───────────────────────────────────────────────────────────────────

echo "dot-ai sync"
echo "  Workspace: $ROOT"
echo "  Skill source: $SCRIPT_DIR"
echo ""

echo "📦 Structure"
ensure_ai_structure
echo ""

echo "🔗 Skill location"
ensure_skill_location
echo ""

echo "🤖 Agent configs"
sync_agents
