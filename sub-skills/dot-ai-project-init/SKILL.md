---
name: dot-ai-project-init
description: Create new project with proper .ai/ structure and validation
triggers: [manual]
internal: true
parent: dot-ai
---

# dot-ai-project-init — New Project Creation

Creates a new project following the `.ai/` convention with minimal required structure.

## When to Use

- Creating a new project in the monorepo
- Setting up `.ai/` structure for existing code
- Called by `dot-ai-audit` to validate project structure

## Usage

**Interactive:**
```
"create new project called <name>"
"init .ai for <name>"
"new project <name> for <purpose>"
```

**Parameters:**
- `name` — project directory name (kebab-case)
- `description` — one-line project description
- `tags` — optional tags for routing

## Process

### Step 1 — Validate Input

Check that:
- Project name is valid (kebab-case, no spaces, alphanumeric + hyphens)
- Project doesn't already exist in `projects/<name>/`
- Description is provided (one line, <100 chars)

### Step 2 — Create Directory Structure

```bash
mkdir -p projects/<name>/.ai/memory/tasks
mkdir -p projects/<name>/.ai/skills
```

### Step 3 — Generate Minimal AGENT.md

```markdown
---
name: <name>
description: <description>
tags: [<tags>]
---

# <Name> — Project Overview

<description>

## Rules

(Add project-specific rules and conventions here)

## Workflows

(Document common workflows for this project)

<!-- dot-ai-agent-sync start -->
<!-- Auto-generated sections will appear here on first sync -->
<!-- dot-ai-agent-sync end -->
```

### Step 4 — Create Optional Files (if requested)

**TOOLS.md** (if project needs specific tools):
```markdown
# Tools — <Name>

Project-specific tool configuration.

## Tool Name

Configuration details...
```

**BACKLOG.md** (if project will have tasks):
```markdown
# BACKLOG — <Name>

## 🔴 Urgent

## 🟡 Next

## 🟢 Later

## ✅ Done (recent)
```

### Step 5 — Validate Structure

Call internal validation (same as `dot-ai-audit` uses):
- AGENT.md exists with valid frontmatter
- Directory structure matches convention
- No forbidden files (SOUL.md, USER.md, IDENTITY.md at project level)

### Step 6 — Register Project

Trigger `dot-ai-workspace-scan` to update `projects-index.md`.

## Validation Function (Used by Audit)

This sub-skill also exposes a **validation-only mode** for audit:

```bash
validate_project_structure "<project-path>"
```

Returns:
- ✅ if structure is valid
- ⚠️ with warnings if fixable issues
- ❌ if critical violations

### Validation Checklist

```
✅ REQUIRED:
- [ ] projects/<name>/.ai/ exists
- [ ] AGENT.md exists
- [ ] AGENT.md has valid YAML frontmatter
- [ ] Frontmatter has required fields: name, description

⚠️ WARNINGS:
- [ ] Missing .ai/memory/ (should exist for notes)
- [ ] Missing .ai/skills/ (should exist if project has skills)
- [ ] AGENT.md missing auto-sync markers (sync not yet run)

❌ VIOLATIONS:
- [ ] SOUL.md at project level (must be root-only)
- [ ] USER.md at project level (must be root-only)
- [ ] IDENTITY.md at project level (must be root-only)
- [ ] Invalid YAML frontmatter
- [ ] Missing required frontmatter fields
```

## Output

**Success:**
```
✅ Project created: projects/<name>

Structure:
  projects/<name>/.ai/
  ├── AGENT.md
  ├── memory/
  │   └── tasks/
  └── skills/

Next steps:
1. Edit projects/<name>/.ai/AGENT.md to add rules and workflows
2. Run `dot-ai-agent-sync` to generate structure overview
3. Start adding project code
```

**Validation mode:**
```
🔍 Validating projects/<name>/.ai/

✅ Structure valid
⚠️ Missing memory/ directory (optional but recommended)
```

## Integration

- **dot-ai-audit** calls this skill's validation function for all projects
- **dot-ai-workspace-scan** updates index after new project creation
- Self-contained, no external skill dependencies (portability)

## Error Handling

| Error | Action |
|-------|--------|
| Project already exists | Abort, show existing path |
| Invalid name | Show validation rules, ask for correction |
| Missing description | Prompt user for description |
| Permission denied | Check directory permissions, report |
| YAML parse error | Show error location, suggest fix |
