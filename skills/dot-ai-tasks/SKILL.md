---
name: dot-ai-tasks
description: Task management across workspace. Backlog tracking, task lifecycle, notes linking.
triggers: [always]
internal: true
disable-model-invocation: true
parent: dot-ai
---

# dot-ai-tasks — Task Management

Unified task management for the workspace. Every request is potentially a task.
This skill manages backlogs, task details, priorities, and lifecycle.

## Principles

1. **Everything is a task** — every non-trivial request should be tracked
2. **One convention everywhere** — same structure at root and project level
3. **Backlog = index, task file = context** — separation of concerns
4. **Priorities are global** — cross-project prioritization for autonomous work

## Structure

```
# Global (cross-project tasks)
.ai/memory/tasks/
├── BACKLOG.md                    ← Global prioritized task list
├── refactoring-dot-ai.md         ← Task details
└── kanban-dashboard.md           ← Task details

# Per-project tasks
projects/<name>/.ai/memory/tasks/
├── BACKLOG.md                    ← Project prioritized task list
├── autoterm-2d.md                ← Task details
└── maxxfan-esp32.md              ← Task details
```

## BACKLOG.md Format

Backlogs are simple, scannable lists. One line per task.

```markdown
# BACKLOG — <Project Name | Global>

## 🔴 Urgent
- [ ] <task title> `<slug>`
- [x] <completed task> `<slug>`

## 🟡 Next
- [ ] <task title> `<slug>`

## 🟢 Later
- [ ] <task title> `<slug>`

## ✅ Done (recent)
- [x] <task title> `<slug>` — <date completed>
```

### Rules
- `[ ]` = todo, `[~]` = in progress, `[x]` = done
- `<slug>` in backticks = filename in `tasks/` (without `.md`)
- Slug is optional — only add when the task has a details file
- Keep ✅ Done section short (last 10 completed, archive older)
- Priority sections are sorted by importance within each level

### Example

```markdown
# BACKLOG — Van Management

## 🔴 Urgent
- [ ] Commander ADUM1201 + connecteurs JST `autoterm-2d`
- [~] Configurer Energy Dashboard HA `energy-dashboard`

## 🟡 Next
- [ ] Câbler Autoterm 2D ESP32 `autoterm-2d`
- [ ] Capteurs niveau eau JSN-SR04T `niveau-eau`

## 🟢 Later
- [ ] Caméra sécurité Reolink
- [ ] Capteurs CO2/CO

## ✅ Done (recent)
- [x] Configurer Renogy BLE `renogy-ble` — 2026-02-05
```

## Task Details File

When a task needs context (research, notes, progress), create a file in `tasks/`:

```markdown
# <Task Title>

> Status: 🟡 In Progress | Project: van-management | Priority: 🔴

## Objective
What this task aims to achieve (1-2 lines).

## Notes
Research, findings, decisions, links, code snippets...
(This is the bulk of the file — freeform, whatever is useful)

## Steps
- [x] Step 1 completed
- [ ] Step 2 pending
- [ ] Step 3 pending

## Decisions
- Decision 1: rationale
- Decision 2: rationale
```

### Rules
- Header metadata (Status/Project/Priority) is for quick scanning
- Notes section is freeform — no rigid structure imposed
- Not every task needs a details file (simple tasks live only in BACKLOG.md)
- Task file persists after completion — it's reference/memory

## Task Lifecycle

### 1. Create
When a new task/request arrives:
1. Add a line in the relevant BACKLOG.md (project or global)
2. If it needs context → create `tasks/<slug>.md`
3. Assign priority based on urgency and impact

### 2. Work
When working on a task:
1. Mark as `[~]` in BACKLOG.md
2. Update the task details file with progress, findings, decisions
3. All outputs related to this task go in the task file

### 3. Complete
When a task is done:
1. Mark as `[x]` in BACKLOG.md, move to ✅ Done section
2. Update task file status to "✅ Done"
3. Keep the task file (reference for future)

### 4. Archive
Periodically (during audit):
- Move old ✅ Done items out of BACKLOG.md (keep last 10)
- Task detail files are never deleted (they're memory)

## Routing

### When to create a task
- User explicitly asks for something that takes multiple steps
- Research or investigation is needed
- Work spans multiple sessions
- User says "add a task", "todo", "backlog", "to do"

### When NOT to create a task
- Quick one-shot questions/answers
- Casual conversation
- Task is completed within the same turn (no need to track)

### Which backlog?
- Task is clearly about one project → `projects/<name>/.ai/memory/tasks/BACKLOG.md`
- Task is cross-project or workspace-level → `.ai/memory/tasks/BACKLOG.md`
- When in doubt → global backlog with a project tag in the title

## Global Priority View

For autonomous work decisions, scan ALL backlogs:

```bash
# Find all BACKLOG.md files
find . -path "*/memory/tasks/BACKLOG.md" -o -path "*/data/BACKLOG.md" 2>/dev/null
```

Priority order for autonomous work:
1. 🔴 Urgent from any project
2. 🟡 Next from projects the user is actively working on
3. 🟡 Next from other projects
4. 🟢 Later only if nothing else

## Migration from old backlog skill

The global `backlog` skill in `.ai/skills/backlog/` is superseded by this sub-skill.
Existing `data/BACKLOG.md` files in projects should be migrated to
`projects/<name>/.ai/memory/tasks/BACKLOG.md`.

## Integration with dot-ai

- **Routing**: when a prompt matches a task, load the task file as context
- **Audit**: `dot-ai-audit` checks BACKLOG.md consistency (no orphan slugs, no missing files)
- **Autonomous work**: `autonomous-work` skill uses global priority view
