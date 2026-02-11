---
name: dot-ai-audit
description: Weekly audit of .ai/ workspace coherence, indexes, and paths
triggers: [heartbeat]
internal: true
disable-model-invocation: true
parent: dot-ai
---

# dot-ai-audit — Workspace Coherence Audit

Weekly audit integrated into the heartbeat cycle.
Checks that all `.ai/` workspace files are coherent, up-to-date,
and synchronized with each other.

## Schedule

- **Frequency**: Once per week (during heartbeat)
- **Track last run** in `memory/heartbeat-state.json`:
  ```json
  { "lastChecks": { "dot-ai-audit": 1706900000 } }
  ```
- Skip if last audit was <6 days ago

## Audit Strategy

**Delegate validation to specialized sync sub-skills.**

Audit orchestrates, sync sub-skills validate:
- `dot-ai-project-init` — validates project structure
- `dot-ai-agent-sync` — validates AGENT.md
- `dot-ai-skill-sync` — validates SKILL.md files
- `dot-ai-backlog-sync` — validates BACKLOG.md and task files
- `dot-ai-memory-sync` — validates memory/ directory structure and notes
- `dot-ai-tools-sync` — validates TOOLS.md definitions and references

This ensures **single source of truth** for validation rules.

## Audit Checklist

### 0. Validate `.ai/` structure convention

**Delegate to:** `dot-ai-project-init` (validation mode)

Every `.ai/` directory (root AND project) must follow the same OpenClaw convention.

**Root `.ai/` expected structure:**
```
.ai/
├── AGENTS.md        # (REQUIRED)
├── SOUL.md          # (REQUIRED)
├── USER.md          # (REQUIRED)
├── IDENTITY.md      # (REQUIRED)
├── TOOLS.md
├── HEARTBEAT.md
├── MEMORY.md
├── memory/          # Daily notes (YYYY-MM-DD.md)
└── skills/          # Global skills
```

**Project `.ai/` expected structure:**
```
projects/<name>/.ai/
├── AGENT.md         # (REQUIRED)
├── TOOLS.md         # (optional)
├── MEMORY.md        # (optional)
├── memory/          # (optional, same convention as root)
└── skills/          # (optional)
```

**Checks:**
```bash
# Scan all .ai/ directories
find . -name ".ai" -type d -maxdepth 4

# For root: verify required files exist
for f in AGENTS.md SOUL.md USER.md IDENTITY.md; do
  [ -f ".ai/$f" ] || echo "⚠️ Root missing: $f"
done

# For each project .ai/: verify AGENT.md exists
for d in projects/*/.ai; do
  [ -f "$d/AGENT.md" ] || echo "⚠️ $(dirname $d) missing: AGENT.md"
done
```

**Convention violations to flag:**
- ❌ Project data in global `memory/tasks/<project>/` → must be in `projects/<name>/.ai/memory/`
- ❌ Project tool config in global `TOOLS.md` → must be in `projects/<name>/.ai/TOOLS.md`
- ❌ Project research/notes in `projects/<name>/docs/` instead of `projects/<name>/.ai/memory/`
- ❌ Identity files (`SOUL.md`, `USER.md`, `IDENTITY.md`) at project level → inherited from root
- ❌ Files outside the convention in `.ai/` (unexpected files)

```bash
# Check for project data leaking into global memory
find .ai/memory/tasks/ -mindepth 1 -maxdepth 1 -type d 2>/dev/null | while read d; do
  echo "⚠️ Project data in global memory: $d → move to projects/<name>/.ai/memory/"
done
```

### 1. Scan all `.ai/` and skills

**Delegate to:** `dot-ai-workspace-scan`

Compares generated overview vs cached `projects-index.md`:
- Detects new projects not in index
- Detects removed projects still in index
- Detects new/removed skills

### 2. Validate AGENT.md files

**Delegate to:** `dot-ai-agent-sync` (validation mode)

For each project:
- Validates frontmatter (required fields, valid YAML)
- Checks staleness (data modified after last sync)
- Validates auto-generated sections between markers
- Reports missing or malformed AGENT.md

### 3. Validate SKILL.md files

**Delegate to:** `dot-ai-skill-sync`

For each SKILL.md found:
- Validates frontmatter (name, description, triggers)
- Checks YAML syntax
- Validates trigger values against allowed list
- Checks description length (<150 chars)

### 4. Validate BACKLOG.md files

**Delegate to:** `dot-ai-backlog-sync`

For each BACKLOG.md (global + all projects):
- Validates structure (required sections)
- Checks orphan slugs (task in BACKLOG but file missing)
- Checks orphan files (task file exists but not in BACKLOG)
- Validates checkbox format and status consistency

### 5. Check for broken paths

```bash
grep -rn "projects/" .ai/ --include="*.md" | grep -v node_modules
```

For each path reference found:
- Check if the path actually exists
- Flag broken references → ⚠️

### 6. Check cache freshness

Validate all metadata cache files:
- `projects-index.md` — compare with workspace-scan output
- `skills-index.json` — verify all skills present
- `activity-index.json` — check if >7 days old
- `data-index.json` (per project) — compare with actual data/

Regenerate stale caches automatically.

### 7. Validate memory structure

**Delegate to:** `dot-ai-memory-sync`

For each `memory/` directory (root + all projects):
- Validates daily note naming convention
- Checks for orphan files
- Verifies projects-index freshness
- Scans for exposed credentials

### 8. Validate TOOLS.md files

**Delegate to:** `dot-ai-tools-sync`

For each `TOOLS.md` (root + all projects):
- Validates structure and required sections
- Checks tool definitions completeness
- Verifies no hardcoded credentials
- Validates scope (root vs project)

## Output Format

```
🔍 dot-ai audit — YYYY-MM-DD

## Structure Convention
✅ Root .ai/ — all required files present
✅ pro/.ai/ — AGENT.md present, structure valid
✅ roule-caillou/.ai/ — AGENT.md present, structure valid
⚠️ van-management/.ai/ — missing memory/ (research notes in docs/ instead)
⚠️ Global memory/tasks/van-domotique/ — project data in global memory

## Projects
✅ pro — AGENT.md up to date
✅ roule-caillou — AGENT.md up to date
⚠️ van-management — AGENT.md stale (data modified 2026-01-28, last sync 2026-01-15)

## Skills Quick Reference
✅ 12 skills documented, 12 found on disk
⚠️ Missing from reference: social-post (projects/pro/.ai/skills/)

## Projects Index
✅ memory/projects-index.md in sync

## Broken Paths
✅ No broken paths found

## Summary
5 checks passed, 3 warnings found
```

## Auto-Fix Rules

| Issue | Action |
|-------|--------|
| Project data in global `memory/tasks/` | **Auto-fix**: move to `projects/<name>/.ai/memory/` |
| Project tool config in global `TOOLS.md` | **Propose** migration to project `TOOLS.md` |
| Missing `AGENT.md` in project `.ai/` | **Report** as critical |
| Missing required root files | **Report** as critical |
| Research/notes in wrong location | **Auto-fix**: move to `projects/<name>/.ai/memory/` |
| Stale AGENT.md (auto-generated sections) | Auto-fix via `dot-ai-agent-sync` |
| Missing skill in Quick Reference | **Propose** the addition, don't auto-apply |
| Ghost skill in Quick Reference | **Propose** removal, don't auto-apply |
| Stale projects-index.md | **Propose** update, don't auto-apply |
| Broken path in auto-generated file | Auto-fix via `dot-ai-agent-sync` |
| Broken path in manual file | **Report** only, never auto-fix |

**Rule**: Auto-fix only content between `dot-ai-agent-sync` markers.
Everything else requires human confirmation.

## Quick Audit Command

For manual runs outside heartbeat:

```
"audit .ai workspace"
"run dot-ai audit"
"check workspace coherence"
```

## Dependencies

- `dot-ai-project-init` — validates .ai/ directory structure convention
- `dot-ai-workspace-scan` — reuses scan logic for project discovery
- `dot-ai-agent-sync` — validates and fixes AGENT.md files
- `dot-ai-skill-sync` — validates SKILL.md frontmatter and triggers
- `dot-ai-backlog-sync` — validates BACKLOG.md and task file consistency
- `dot-ai-memory-sync` — validates memory/ directory structure and notes
- `dot-ai-tools-sync` — validates TOOLS.md definitions and references
