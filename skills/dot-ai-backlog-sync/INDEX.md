# dot-ai-backlog-sync — Quick Reference

Validate BACKLOG.md structure and check orphan task slugs

## Triggers
- Audit: called by dot-ai-audit for all BACKLOG.md files (global + project-level)

## Validation Rules

### 1. Structure
- Must have header `# BACKLOG — <name>`
- Must have priority sections (🔴 Urgent, 🟡 Next, 🟢 Later, ✅ Done)
- Task lines must use checkbox format: `[ ]`, `[~]`, or `[x]`

### 2. Slug References
- Orphan slug: task has `` `slug-name` `` but `tasks/<slug-name>.md` missing
- Orphan file: `tasks/<slug-name>.md` exists but not referenced in BACKLOG

### 3. Status Consistency
- `[ ]` tasks should be in 🔴/🟡/🟢 sections
- `[~]` tasks should be in 🔴/🟡 sections (in progress)
- `[x]` tasks should be in ✅ Done section

## Auto-Fix Rules

All auto-fixes require user confirmation:
- Missing sections → Add empty sections with proper emoji headers
- Orphan slug → Remove from BACKLOG or create placeholder task file
- Orphan file → Add entry to BACKLOG.md in 🟢 Later section
- Status mismatch → Move task to correct section based on status
- Invalid header → Fix to standard format

## Output Format

**Valid:** `✅ .ai/memory/tasks/BACKLOG.md - 5 tasks tracked (3 pending, 2 done) - All slugs have task files`

**Issues:** `⚠️ projects/app/.ai/memory/tasks/BACKLOG.md - Orphan slug: 'property-scoring' (file missing) - Orphan file: autoterm-config.md (not in BACKLOG)`

**Error:** `❌ projects/van/.ai/memory/tasks/BACKLOG.md - Missing required section: 🔴 Urgent - Invalid header format`

See SKILL.md for: validation process, expected structure, integration with audit
