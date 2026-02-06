---
name: dot-ai-backlog-sync
description: Validate BACKLOG.md structure and check orphan task slugs
triggers: [audit]
internal: true
parent: dot-ai
---

# dot-ai-backlog-sync — BACKLOG.md Validation

Validates `BACKLOG.md` files (global and project-level) for structural consistency
and detects orphan slugs (tasks referenced but files missing).

Called by `dot-ai-audit` for validation.

## Expected Structure

```markdown
# BACKLOG — <Project Name | Global>

## 🔴 Urgent
- [ ] Task title `slug-name`
- [~] In progress task `slug-name`
- [x] Done task `slug-name`

## 🟡 Next
- [ ] Task title `slug-name`

## 🟢 Later
- [ ] Task title

## ✅ Done (recent)
- [x] Completed task `slug-name` — YYYY-MM-DD
```

## Validation Rules

### 1. Structure

- ✅ Must have header `# BACKLOG — <name>`
- ✅ Must have priority sections (🔴 Urgent, 🟡 Next, 🟢 Later, ✅ Done)
- ⚠️ Sections can be empty (that's fine)
- ✅ Task lines must use checkbox format: `[ ]`, `[~]`, or `[x]`

### 2. Slug References

For tasks with slugs (`` `slug-name` ``):
- ✅ Check if `tasks/<slug-name>.md` exists
- ❌ If missing → **orphan slug** (task file deleted but still in BACKLOG)

For task files in `tasks/`:
- ✅ Check if slug is referenced in BACKLOG.md
- ⚠️ If missing → **orphan file** (task file exists but not in BACKLOG)

### 3. Status Consistency

- `[ ]` tasks should be in 🔴/🟡/🟢 sections
- `[~]` tasks should be in 🔴/🟡 sections (in progress)
- `[x]` tasks should be in ✅ Done section

## Validation Process

```bash
# 1. Parse BACKLOG.md
header = extract_header(backlog)
sections = extract_sections(backlog)
tasks = extract_tasks(backlog)

# 2. Extract slugs from tasks
slugs = extract_slugs(tasks)

# 3. Check task files exist
for slug in slugs:
  if not exists("tasks/{slug}.md"):
    report_orphan_slug(slug)

# 4. Check task files referenced
task_files = list_files("tasks/")
for file in task_files:
  slug = filename_to_slug(file)
  if slug not in slugs:
    report_orphan_file(slug)
```

## Output Format

**Valid BACKLOG:**
```
✅ .ai/memory/tasks/BACKLOG.md
   - 5 tasks tracked (3 pending, 2 done)
   - All slugs have task files
```

**Issues detected:**
```
⚠️ projects/roule-caillou/.ai/memory/tasks/BACKLOG.md
   - Orphan slug: `property-scoring` (file missing)
   - Orphan file: autoterm-config.md (not in BACKLOG)
   - Status mismatch: [x] task in 🟡 Next section (should be in ✅ Done)
```

**Structure error:**
```
❌ projects/van-management/.ai/memory/tasks/BACKLOG.md
   - Missing required section: 🔴 Urgent
   - Invalid header format (should be: # BACKLOG — Van Management)
```

## Auto-Fix Rules

| Issue | Auto-Fix |
|-------|----------|
| Missing sections | Add empty sections with proper emoji headers |
| Orphan slug | Remove from BACKLOG or create placeholder task file |
| Orphan file | Add entry to BACKLOG.md in 🟢 Later section |
| Status mismatch | Move task to correct section based on status |
| Invalid header | Fix to standard format |

**All auto-fixes require user confirmation.**

## Integration with Audit

`dot-ai-audit` calls this sub-skill for all BACKLOG.md files:

```
For each BACKLOG.md (global + all projects):
  result = dot-ai-backlog-sync.validate(backlog_path)
  if result.warnings or result.errors:
    report issues
  if auto_fix_approved:
    apply fixes
```

## Commands

| Command | Action |
|---------|--------|
| "validate backlog" | Validate global BACKLOG.md |
| "validate backlog for <project>" | Validate project BACKLOG.md |
| "fix backlog orphans" | Auto-fix orphan slugs/files |
| "sync backlog <project>" | Full sync with auto-fixes |
