---
name: dot-ai-memory-sync
description: Validate memory/ directory structure and session notes
triggers: [manual]
internal: true
parent: dot-ai
---

# dot-ai-memory-sync — Memory Structure Validation

Quick reference: See [INDEX.md](./INDEX.md)

## Purpose

Validate the structure and organization of `memory/` directories, ensuring daily notes follow naming conventions, task/research directories are properly organized, and no orphan files exist outside standard locations.

## Validation Process

### 1. Directory Structure Check

Verify standard memory organization exists:

```
.ai/memory/
├── YYYY-MM-DD.md          # Daily session notes
├── projects-index.md       # Workspace routing map
├── BACKLOG.md             # Global task index
├── tasks/                 # Global task details
│   └── {slug}.md
└── research/              # Research notes
```

**Validation:**
- All required directories exist
- No unexpected directories (exclude exports/, imports/)
- Directory permissions are correct

**Auto-fix:**
- Create missing directories: `tasks/`, `research/`
- Warn about unexpected directories (user decision to keep/remove)

### 2. Daily Notes Validation

Daily session notes must follow `YYYY-MM-DD.md` format.

**Validation rules:**
- Filename matches regex: `^\d{4}-\d{2}-\d{2}\.md$`
- Date is valid (no 2024-02-30.md)
- File size reasonable (< 1MB, warn if > 500KB)
- Valid markdown format (no syntax errors)

**Common errors:**
- `2024-2-5.md` → should be `2024-02-05.md` (zero-padded)
- `jan-15-2024.md` → should be `2024-01-15.md` (ISO format)
- `notes-2024-01-15.md` → should be `2024-01-15.md` (no prefix)

**Auto-fix:**
- Rename incorrectly formatted dates (with confirmation)
- Move non-date files to `research/` (with confirmation)

### 3. Projects Index Validation

Check `.ai/memory/projects-index.md` structure and freshness.

**Validation:**
- File exists
- Valid markdown table format
- No broken project references (projects still exist)
- Update marker present: `<!-- dot-ai-workspace-scan last-updated: YYYY-MM-DD -->`
- Freshness: warn if > 7 days old

**Auto-fix:**
- Create missing file → trigger workspace-scan
- Regenerate if > 7 days old → trigger workspace-scan
- Remove broken references (with confirmation)

### 4. Task Directory Validation

Check `tasks/` directory structure.

**Validation:**
- All task files are valid markdown
- Filenames use kebab-case (slug format)
- No duplicate slugs
- Cross-reference with BACKLOG.md (via backlog-sync)

**Note:** Detailed task validation is handled by [dot-ai-backlog-sync](../dot-ai-backlog-sync/SKILL.md).

### 5. Research Directory Validation

Check `research/` directory organization.

**Validation:**
- All files are valid markdown or supported formats
- No sensitive data in filenames or content
- Reasonable file sizes
- Organized subdirectories are valid

**Auto-fix:**
- Warn about large files (> 5MB)
- Suggest moving large binary files to `.ai/data/`

### 6. Orphan File Detection

Find files in `memory/` that don't fit standard locations.

**Orphan files:**
- Files not matching daily note pattern
- Files not in `tasks/`, `research/`, or standard locations
- Temporary files (`.tmp`, `.bak`, `.swp`)

**Auto-fix:**
- List all orphans
- Suggest move to `research/` or deletion
- Auto-delete temp files (with confirmation)

### 7. Content Safety Check

Scan for sensitive data exposure.

**Patterns to detect:**
- API keys (regex patterns)
- Passwords (common patterns)
- Personal identifiable information
- Hardcoded credentials

**Action:**
- Warn user of potential sensitive data
- Never auto-fix (security issue)
- Suggest manual review

## Integration

### Called by dot-ai-audit

```typescript
// audit triggers memory-sync for all memory/ directories
const memoryDirs = findMemoryDirectories();
for (const dir of memoryDirs) {
  await validateMemoryStructure(dir);
}
```

### Related Skills

- **[workspace-scan](../dot-ai-workspace-scan/SKILL.md)** — generates projects-index.md
- **[backlog-sync](../dot-ai-backlog-sync/SKILL.md)** — validates BACKLOG.md and task slugs
- **[dot-ai-audit](../dot-ai-audit/SKILL.md)** — orchestrates all validation

## Output Format

See [CONVENTIONS.md](../dot-ai/CONVENTIONS.md#output-formats) for standard output format.

**Example outputs:**

```
✅ .ai/memory/ — 45 daily notes, projects-index fresh (2d), all directories valid

⚠️ .ai/memory/ — File '2024-2-5.md' should be '2024-02-05.md', orphan file: random-notes.md

❌ projects/app/.ai/memory/ — Missing tasks/ directory, malformed date: 'jan-15-2024.md'
```

## Commands

Manual invocation:

```
"sync memory"
"validate memory structure"
"check memory organization"
```

Auto-invocation by audit:

```
"audit workspace"  # includes memory-sync
```
