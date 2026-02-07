# Shared Conventions for dot-ai Sub-Skills

This file documents patterns and standards shared across all dot-ai sub-skills.
Skills should reference this file instead of duplicating content.

## Marker Pattern

All auto-managed content uses HTML comment markers:

```markdown
<!-- dot-ai-{skill-name} start -->
...auto-generated content...
<!-- dot-ai-{skill-name} end -->
```

**Properties:**
- Markers are HTML comments (invisible when rendered)
- Content between markers is auto-managed
- Content outside markers is never touched
- Skill name in marker matches the skill directory name

**Used by:** agent-sync, skill-sync, backlog-sync, workspace-scan

**Example:**
```markdown
# AGENT.md

Manual content here is preserved.

<!-- dot-ai-agent-sync start -->
## Metadata (auto-generated)
...
<!-- dot-ai-agent-sync end -->

More manual content preserved here.
```

## Frontmatter Schema

YAML frontmatter for SKILL.md files:

```yaml
---
name: string           # Required, kebab-case, matches directory name
description: string    # Required, <150 chars, one-line purpose
triggers: array        # Required, valid trigger phrases
internal: boolean      # Optional, true if not user-invocable
parent: string         # Optional, parent skill (when internal: true)
status: string         # Optional: "planned", "experimental", "deprecated"
---
```

**Validation rules:**
- `name`: Must be kebab-case, no spaces, match directory name
- `description`: Single line, under 150 characters
- `triggers`: Array of strings, valid phrases that invoke skill
- `internal`: If true, skill is reference-only (used by other skills)
- `parent`: Required when `internal: true`, references parent skill
- `status`: Only use for non-stable skills

**Used by:** skill-sync, workspace-scan, audit

**Valid trigger patterns:**
- `[always]` - Always active (e.g., model-selection, context-strategy)
- `[manual]` - User must explicitly invoke
- `["phrase one", "phrase two"]` - Specific phrases
- `[heartbeat]` - Triggered by scheduled heartbeat

## Output Formats

Standardized output for validation and sync operations:

```
✅ Success: <file-path> — <summary>
⚠️ Warning: <file-path> — <issues-list>
❌ Error: <file-path> — <critical-issues>
```

**Success (✅):**
- File validated successfully
- No issues found
- Optional summary of what was checked

**Warning (⚠️):**
- File has non-critical issues
- Auto-fix available but not applied
- Lists specific issues found

**Error (❌):**
- File has critical issues
- Cannot proceed without fixes
- Lists blocking issues

**Used by:** All sync skills (agent-sync, skill-sync, backlog-sync, tools-sync, memory-sync)

**Auto-fix rules:**
- All fixes require user confirmation
- Never auto-apply destructive changes
- Always show diff before applying

## Validation Process

Standard validation workflow for all sync skills:

1. **Read file** - Load content, handle missing files
2. **Check structure** - Validate required sections/fields
3. **Report issues** - Use standard output format
4. **Offer auto-fix** - Propose fixes (requires confirmation)
5. **Validate again** - Verify fixes worked

**Used by:** All sync skills

**Error handling:**
- Missing file: Offer to create from template
- Invalid structure: Offer to fix
- Broken references: Offer to remove or update

## Directory Structure

Standard `.ai/` directory layout:

```
.ai/
├── AGENTS.md              # AI system documentation (required)
├── SOUL.md                # Workspace personality/rules (optional)
├── USER.md                # User preferences/context (optional)
├── IDENTITY.md            # Project identity/vision (optional)
├── TOOLS.md               # Available tools/integrations (optional)
├── memory/
│   ├── YYYY-MM-DD.md                # Daily session notes
│   ├── projects-index.md            # Active projects routing map
│   ├── BACKLOG.md                   # Global task index
│   ├── tasks/                       # Global task details
│   │   └── {slug}.md
│   └── research/                    # Research notes
├── data/                  # Structured exploitable data ONLY
│   ├── exports/           # Generated exports (CSV, JSON)
│   └── imports/           # External data imports
├── projects/
│   └── {project-name}/
│       └── .ai/           # Per-project AI context
│           ├── AGENT.md   # Project-specific docs
│           └── memory/
│               ├── BACKLOG.md
│               └── tasks/
└── skills/
    └── dot-ai/            # Symlink to plugin skills directory
        ├── BOOTSTRAP.md
        ├── SKILL.md
        └── CONVENTIONS.md (this file)
```

**Key principles:**
- Root `.ai/` for workspace-wide context
- Projects get their own `.ai/` subdirectory
- Data separation: `.ai/data/` = structured only, no research/drafts
- Memory organization: daily notes, tasks, research separated

**Used by:** All skills, documented once here

## Exclusion Patterns

Files/directories to ignore during scans and syncs:

```
node_modules/
.git/
.next/
dist/
build/
__pycache__/
*.pyc
.DS_Store
Thumbs.db
```

**Used by:** workspace-scan, export, agent-sync

**Stored in:** `.ai/.ignore-patterns` (if workspace wants to customize)

## Template Files

Standard templates for generated content:

See: `skills/dot-ai/templates/` directory

Available templates:
- `BACKLOG.template.md` - Task backlog index structure
- `AGENT.template.md` - Project AGENT.md boilerplate
- `SKILL.template.md` - Skill documentation structure
- `task-details.template.md` - Individual task file format
- `validation-output.template.md` - Validation report format

**Used by:** project-init, task creation, sync operations
