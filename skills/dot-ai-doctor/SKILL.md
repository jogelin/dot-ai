---
name: dot-ai-doctor
description: Workspace health check and troubleshooting tool
triggers: [manual]
internal: true
disable-model-invocation: true
parent: dot-ai
---

# dot-ai-doctor — Health Check

Diagnose and fix common workspace issues.

## Triggers

- Manual: "doctor", "health check", "diagnose workspace"
- Auto-suggested: when sync operations fail
- Heartbeat: optional health check on startup

## Health Checks

### 1. Structure Validation

**Check:** `.ai/` directory structure exists and is correct

**Validates:**
- `.ai/` directory exists
- Required subdirectories: `memory/`, `skills/`
- Permissions: readable and writable

**Auto-fix:**
- Create missing directories
- Fix permissions (chmod 755 for dirs, 644 for files)

### 2. Required Files

**Check:** Essential files present

**Validates:**
- `AGENTS.md` exists (required)
- `skills/dot-ai/` directory or symlink exists
- `memory/projects-index.md` exists (or can be generated)

**Auto-fix:**
- Create AGENTS.md from template
- Create symlink to plugin skills/dot-ai/
- Run workspace-scan to generate projects-index.md

### 3. Symlinks Validation

**Check:** Symlinks are valid (not broken)

**Validates:**
- `.ai/skills/dot-ai` points to valid directory
- No circular symlinks
- Target files exist

**Auto-fix:**
- Remove broken symlinks
- Recreate symlinks to correct targets

### 4. Orphan Detection

**Check:** No orphan files (tasks without backlog references)

**Validates:**
- All `tasks/*.md` files referenced in `BACKLOG.md`
- All BACKLOG slug references have corresponding files
- No dangling references

**Auto-fix:**
- Add orphan files to BACKLOG (🟢 Later section)
- Remove or flag broken references

### 5. Cache Freshness

**Check:** Cached files are up-to-date

**Validates:**
- `memory/projects-index.md` modified within 7 days
- No stale auto-generated content (check timestamps)

**Auto-fix:**
- Run workspace-scan to refresh projects-index.md
- Run agent-sync to refresh stale AGENT.md sections

### 6. Disk Space

**Check:** Sufficient disk space for operations

**Validates:**
- Workspace directory has >100MB free
- Home directory has >500MB free

**Warning only:** (no auto-fix)

### 7. Git Repository Status

**Check:** Git repository is in good state

**Validates:**
- Is a git repository
- No untracked `.ai/` files that should be committed
- No large files in `.ai/` (>10MB warning)

**Suggestion only:** (no auto-fix)

## Output Format

```
🏥 dot-ai Health Check

Overall Health: 85/100 (Good)

✅ Passed (5):
  - Structure validation
  - Required files
  - Symlinks validation
  - Cache freshness
  - Disk space

⚠️ Warnings (2):
  - Orphan files: 3 tasks without BACKLOG references
  - Git status: 5 untracked files in .ai/

❌ Errors (0):
  (none)

💊 Suggested Fixes:
  1. Run backlog-sync to add orphan tasks
  2. Run `git add .ai/` to track files

Run with --fix to apply automatic fixes (requires confirmation).
```

## Commands

```bash
# Basic health check
"doctor" or "health check"

# With auto-fix
"doctor --fix" or "health check and fix"

# Detailed report
"doctor --verbose" or "detailed health check"

# Specific check
"doctor check structure" or "check symlinks"
```

## Integration

Used by:
- `dot-ai-audit` — Runs doctor when validation fails
- Sync skills — Suggest doctor when errors occur
- User — Manual troubleshooting

## Troubleshooting Guide

### Issue: "No .ai/ directory found"
**Fix:** Run `dot-ai-project-init` or create manually

### Issue: "Broken symlink: skills/dot-ai"
**Fix:** Run `scripts/sync.sh` to recreate symlink

### Issue: "Orphan tasks detected"
**Fix:** Run `dot-ai-backlog-sync` with auto-fix

### Issue: "Stale projects-index.md"
**Fix:** Run `dot-ai-workspace-scan` to refresh

### Issue: "Permission denied"
**Fix:** Run `chmod -R u+w .ai/` to fix permissions

## Cross-References

- Structure validation: See `dot-ai/CONVENTIONS.md`
- Sync operations: See `dot-ai-audit` skill
- Template creation: See `dot-ai/templates/` directory
