#!/usr/bin/env bash
set -euo pipefail

# dot-ai sync — Updates native AI tool configs to reference the dot-ai skill.
# Auto-detects its own location and the workspace root. No hardcoded paths.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_FILE="$SCRIPT_DIR/SKILL.md"

# Find workspace root.
# If called via symlink (e.g. .ai/skills/dot-ai → ~/dev/dot-ai),
# resolve from the symlink location (PWD-relative), not the script target.
# Accepts an explicit root as first argument.
find_workspace_root() {
  # Explicit argument takes priority
  if [[ -n "${1:-}" ]]; then
    echo "$1"
    return
  fi

  # Try to resolve from the symlink source (the calling path)
  # $0 may be the symlink path if invoked as `.ai/skills/dot-ai/sync.sh`
  local call_dir
  call_dir="$(cd "$(dirname "$0")" && pwd -P 2>/dev/null || echo "$SCRIPT_DIR")"

  # If call_dir is inside a .ai/skills/ tree, derive root from there
  if [[ "$call_dir" == */.ai/skills/* ]]; then
    echo "${call_dir%%/.ai/skills/*}"
    return
  fi

  # Fallback: walk up from cwd looking for .ai/
  local dir="$PWD"
  while [[ "$dir" != "/" ]]; do
    if [[ -d "$dir/.ai" ]]; then
      echo "$dir"
      return
    fi
    dir="$(dirname "$dir")"
  done

  # Last resort: walk up from script dir looking for .ai/ (not .git)
  dir="$SCRIPT_DIR"
  while [[ "$dir" != "/" ]]; do
    if [[ -d "$dir/.ai" && "$dir" != "$SCRIPT_DIR" ]]; then
      echo "$dir"
      return
    fi
    dir="$(dirname "$dir")"
  done

  echo "$PWD"
}

ROOT="$(find_workspace_root "${1:-}")"
SKILL_REL="$(python3 -c "import os; print(os.path.relpath('$SKILL_FILE', '$ROOT'))")"

MARKER_START="<!-- dot-ai start -->"
MARKER_END="<!-- dot-ai end -->"

log() { echo "  $1"; }

# Inject or update content between markers in a file.
# If markers don't exist and file exists, append.
# If file doesn't exist, create it.
inject_markers() {
  local file="$1"
  local content="$2"
  local block
  block=$(printf '%s\n%s\n%s' "$MARKER_START" "$content" "$MARKER_END")

  if [[ ! -f "$file" ]]; then
    mkdir -p "$(dirname "$file")"
    echo "$block" > "$file"
    log "✅ Created $file"
    return
  fi

  if grep -q "dot-ai start" "$file" 2>/dev/null; then
    # Replace existing block
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
    log "🔄 Updated $file"
  else
    # Append block
    echo "" >> "$file"
    echo "$block" >> "$file"
    log "➕ Appended to $file"
  fi
}

echo "dot-ai sync"
echo "  Workspace: $ROOT"
echo "  Skill: $SKILL_REL"
echo ""

synced=0

# --- Claude Code ---
CLAUDE_FILE="$ROOT/CLAUDE.md"
if [[ -f "$CLAUDE_FILE" ]] || command -v claude &>/dev/null; then
  content="<!-- Auto-managed by dot-ai. Do not edit between markers. -->
@$SKILL_REL"
  inject_markers "$CLAUDE_FILE" "$content"
  synced=$((synced + 1))
fi

# --- OpenClaw ---
# OpenClaw loads .ai/AGENTS.md as project context in the system prompt.
# Inject instruction to read the dot-ai skill at boot.
OPENCLAW_FILE="$ROOT/.ai/AGENTS.md"
if [[ -f "$OPENCLAW_FILE" ]] || command -v openclaw &>/dev/null; then
  content="<!-- Auto-managed by dot-ai. Do not edit between markers. -->
**Boot requirement:** Read and follow \`$SKILL_REL\` at every session start.
This skill defines the workspace convention (file structure, routing, memory, skills)."
  inject_markers "$OPENCLAW_FILE" "$content"
  synced=$((synced + 1))
fi

# --- OpenAI Codex ---
# Codex uses AGENTS.md at repo root (not the same as .ai/AGENTS.md)
CODEX_FILE="$ROOT/AGENTS.md"
if [[ -f "$CODEX_FILE" ]]; then
  content="<!-- Auto-managed by dot-ai. Do not edit between markers. -->
Read and follow $SKILL_REL for workspace conventions."
  inject_markers "$CODEX_FILE" "$content"
  synced=$((synced + 1))
fi

# --- Windsurf ---
if [[ -d "$ROOT/.windsurf" ]] || [[ -f "$ROOT/.windsurfrules" ]]; then
  WINDSURF_DIR="$ROOT/.windsurf/rules"
  content="# dot-ai workspace convention
# Activation: Always On
Read and follow $SKILL_REL for workspace conventions."
  inject_markers "$WINDSURF_DIR/dot-ai.md" "$content"
  synced=$((synced + 1))
fi

# --- Cursor ---
if [[ -d "$ROOT/.cursor" ]] || [[ -f "$ROOT/.cursorrules" ]]; then
  CURSOR_DIR="$ROOT/.cursor/rules"
  content="# dot-ai workspace convention
Read and follow $SKILL_REL for workspace conventions."
  inject_markers "$CURSOR_DIR/dot-ai.md" "$content"
  synced=$((synced + 1))
fi

echo ""
if [[ $synced -eq 0 ]]; then
  echo "⚠️  No AI tools detected. Create CLAUDE.md, AGENTS.md, .windsurf/, or .cursor/ first."
else
  echo "✅ Synced $synced tool(s)"
fi
