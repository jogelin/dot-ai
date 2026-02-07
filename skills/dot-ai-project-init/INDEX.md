# dot-ai-project-init — Quick Reference

Creates new projects with proper `.ai/` structure and validates existing projects.

## Triggers
- Manual: "create new project called <name>", "init .ai for <name>", "new project <name> for <purpose>"
- Audit: Called by `dot-ai-audit` to validate all projects

## Required Input
- `name` — project directory name (kebab-case, alphanumeric + hyphens)
- `description` — one-line project description (<100 chars)
- `tags` — optional tags for routing

## Created Structure
```
projects/<name>/.ai/
├── AGENT.md          # Project overview with frontmatter
├── memory/
│   └── tasks/        # Task tracking
└── skills/           # Project-specific skills
```

Optional files: TOOLS.md, BACKLOG.md

## Validation Function
Used by `dot-ai-audit` to check existing projects:

```bash
validate_project_structure "<project-path>"
```

Returns ✅ (valid), ⚠️ (warnings), or ❌ (violations).

**Checks:**
- Required: `.ai/` dir, AGENT.md, valid frontmatter (name, description)
- Warnings: Missing memory/, skills/, or auto-sync markers
- Violations: Root-only files (SOUL.md, USER.md, IDENTITY.md), invalid YAML

See SKILL.md for: validation checklist, error handling, AGENT.md template
