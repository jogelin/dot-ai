# dot-ai-tasks — Quick Reference

Always-active task management for workspace-wide tracking.

## Triggers
- Always active (internal skill)
- Use instead of: Claude Code's built-in Todo system

## Structure Convention

Two-level hierarchy with identical structure:

```
# Global (cross-project)
.ai/memory/tasks/
├── BACKLOG.md       # Prioritized index
└── task-slug.md     # Task details

# Per-project
projects/<name>/.ai/memory/tasks/
├── BACKLOG.md       # Project index
└── task-slug.md     # Task details
```

## Task Format

### BACKLOG.md (one line per task)
```markdown
## 🔴 Urgent
- [ ] Task title `slug-name`
- [~] In progress task `slug-name`

## 🟡 Next
- [ ] Another task `slug-name`

## 🟢 Later
- [ ] Low priority task

## ✅ Done (recent)
- [x] Completed task `slug-name` — 2026-02-05
```

### tasks/slug-name.md (when context needed)
```markdown
# Task Title

> Status: 🟡 In Progress | Project: name | Priority: 🔴

## Objective
What this achieves (1-2 lines)

## Notes
Freeform research, decisions, links, code...
```

## Routing

**Project-specific work** → `projects/<name>/.ai/memory/tasks/BACKLOG.md`
**Cross-project or workspace-level** → `.ai/memory/tasks/BACKLOG.md`
**When unclear** → Global backlog with project tag in title

Not every task needs a detail file — simple tasks live only in BACKLOG.md.

## Priority Markers

- **🔴 Urgent** — Critical, blocking, immediate attention
- **🟡 Next** — Queued, actively planned
- **🟢 Later** — Backlog, no timeline
- **✅ Done** — Completed (keep last 10, archive older)

## Checkbox States

- `[ ]` = todo
- `[~]` = in progress
- `[x]` = done

## See SKILL.md for

- Task lifecycle (create → work → complete → archive)
- Global priority view for autonomous work
- Migration from old backlog system
- Integration with dot-ai-audit
