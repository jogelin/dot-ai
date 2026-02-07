---
name: dot-ai
description: Universal AI workspace convention. Discovery, structure, boot, routing.
triggers: [boot, always]
version: 0.2.0
---

# dot-ai — Universal AI Workspace Convention

You are working in a project that follows the `.ai/` convention.
This skill defines how to discover, load, and navigate AI workspaces.
Follow these instructions at every session start.

## What is `.ai/`?

A `.ai/` directory is a standardized workspace for AI assistants.
It contains everything an AI needs to understand and work within a project:
identity, rules, memory, skills, and project context.

`.ai/` directories can exist at multiple levels:
- **Root level**: the main workspace (global context, identity, memory)
- **Project level**: per-project context (specific rules, skills, data)

A project is any directory containing a `.ai/` subdirectory.

## File Structure

### Root `.ai/`

```
.ai/
├── AGENTS.md        # Operating rules, conventions, behavior
├── SOUL.md          # Persona, tone, boundaries
├── USER.md          # Who the human is
├── IDENTITY.md      # Agent name, emoji, vibe
├── TOOLS.md         # Local tool notes and setup
├── HEARTBEAT.md     # Periodic checks (optional)
├── MEMORY.md        # Curated long-term memory (optional, private)
├── BOOT.md          # Startup checklist on restart (optional)
├── memory/          # Daily notes (memory/YYYY-MM-DD.md)
└── skills/          # Global skills
    └── <name>/
        └── SKILL.md
```

### Project `.ai/`

Project `.ai/` **mirrors the root `.ai/` structure** — same convention, same patterns.
Only include what the project needs; `AGENT.md` is the only required file.

```
projects/<name>/.ai/
├── AGENT.md         # Project description, rules, conventions (REQUIRED)
├── TOOLS.md         # Project-specific tool config (optional)
├── MEMORY.md        # Project-scoped curated long-term memory (optional)
├── memory/          # Project-scoped notes, research, daily logs (optional)
│   └── YYYY-MM-DD.md
├── skills/          # Project-specific skills (optional)
│   └── <name>/
│       └── SKILL.md
└── data/            # Project structured data: backlogs, JSON, exports (optional)
```

**Principle: same convention everywhere.**
A project `.ai/` uses the exact same patterns as root `.ai/`.
- `MEMORY.md` = curated long-term memory for the project
- `memory/` = daily notes, research, investigation context
- `TOOLS.md` = tool config scoped to the project
- `skills/` = skills scoped to the project
- `data/` = structured data (backlogs, JSON exports, reports)

The only files that do NOT exist at project level are identity files
(`SOUL.md`, `USER.md`, `IDENTITY.md`) — those are inherited from root.

### Inheritance

Project `.ai/` inherits from root `.ai/` and follows the **same convention**.
- Identity files (`SOUL.md`, `USER.md`, `IDENTITY.md`) are inherited — never redeclared.
- All other files (`TOOLS.md`, `MEMORY.md`, `memory/`, `skills/`) can exist at project level.
- Only `AGENT.md` is required at project level.
- When a file exists at both levels, the project-level file takes precedence for project context.

## File Responsibilities

| File | Scope | Purpose | Load |
|------|-------|---------|------|
| `AGENTS.md` | Root | Global rules, conventions, how to behave | Always at boot |
| `AGENT.md` | Project | Project description, specific rules | On-demand (when routing to project) |
| `SOUL.md` | Root | Persona, tone, voice, boundaries | Always at boot |
| `USER.md` | Root | Human identity, preferences, context | Always at boot |
| `IDENTITY.md` | Root | Agent name, emoji, avatar | Always at boot |
| `TOOLS.md` | Root | **Cross-project** tool config only (Google, etc.) | Always at boot |
| `TOOLS.md` | Project | Project-specific tool config (HA, SSH, etc.) | On-demand (when routing to project) |
| `MEMORY.md` | Root | Long-term curated memory | Main session only (private) |
| `HEARTBEAT.md` | Root | Periodic check instructions | On heartbeat only |
| `BOOT.md` | Root | Startup tasks on restart | On restart only |
| `memory/*.md` | Root | Daily logs | Today + yesterday at boot |
| `skills/` | Both | Skill definitions | On-demand (when triggered) |
| `data/` | Project | Project-specific data | On-demand |

## Frontmatter Conventions

### AGENT.md (project descriptor)

```yaml
---
name: my-project
description: Short description of the project (one line)
tags: [tag1, tag2, tag3]
---
```

### SKILL.md (skill definition)

```yaml
---
name: my-skill
description: What this skill does (one line)
triggers: [manual, heartbeat, cron, boot]
---
```

**Trigger types:**
- `manual` — Invoked by user prompt
- `heartbeat` — Runs during periodic heartbeat checks (see HEARTBEAT integration below)
- `cron` — Runs on a schedule
- `boot` — Runs at session start
- `always` — Always active

Frontmatter uses standard YAML between `---` delimiters.
It MUST be the first thing in the file.

## HEARTBEAT Integration

Skills with `triggers: [heartbeat]` integrate with the periodic heartbeat cycle.

**Reference:** [OpenClaw Heartbeat Documentation](https://docs.openclaw.ai/gateway/heartbeat)

### How it works

1. HEARTBEAT.md defines the schedule and checks
2. Skills register as heartbeat listeners via `triggers: [heartbeat]`
3. During heartbeat cycle, eligible skills are invoked
4. Last run timestamp tracked in `memory/heartbeat-state.json`

### Heartbeat Skills in dot-ai

| Skill | Frequency | Purpose |
|-------|-----------|---------|
| `dot-ai-audit` | Weekly | Full workspace coherence check |

### Configuration

Add to `.ai/HEARTBEAT.md`:

```markdown
# Heartbeat Configuration

## Schedule

- **dot-ai-audit**: Every 7 days
- (other heartbeat checks...)

## State Tracking

Last check timestamps stored in `.ai/memory/heartbeat-state.json`:

\```json
{
  "lastChecks": {
    "dot-ai-audit": 1707235200,
    "other-check": 1707148800
  }
}
\```
```

Skills check this file to avoid running too frequently.

## Boot Sequence

Execute this sequence at every session start:

### Phase 1 — Load root context

1. Find the root `.ai/` directory (current directory or nearest parent)
2. Load in order: `AGENTS.md` → `SOUL.md` → `USER.md` → `IDENTITY.md` → `TOOLS.md`
3. Load `memory/YYYY-MM-DD.md` for today and yesterday
4. If main/private session: load `MEMORY.md`

### Phase 2 — Discover projects

1. From the workspace root, scan for `.ai/` directories:
   ```
   find . -name ".ai" -type d -maxdepth 3
   ```
2. For each `.ai/` found (excluding root):
   - Read ONLY the frontmatter of `AGENT.md` (between `---` markers)
   - List skill directories: `ls skills/` (names only)
   - For each skill, read ONLY its frontmatter
3. Build the workspace overview (see format below)

### Phase 3 — Ready

The workspace overview is now in memory. You are ready to route prompts.
Do NOT load full project context yet. Wait for a prompt that matches a project.

### Boot Log

**Output a compact boot log at the end of the boot sequence.**
This gives the human visibility into what happened during boot.

The log MUST be the **first message** of the session (before answering any prompt).
Use a single compact block — no walls of text.

**Format:**

```
🥝 dot-ai boot
├─ 🏠 Root context — loaded (AGENTS, SOUL, USER, IDENTITY, TOOLS)
├─ 📝 memory/YYYY-MM-DD.md — loaded (+yesterday)
├─ 🧠 MEMORY.md — loaded | skipped (not main session)
├─ 📁 N projects scanned, M skills indexed
├─ 📋 projects-index.md — fresh (Xd) | regenerated (stale) | created
├─ 🔍 Audit — not due (last: Xd ago) | running | skipped
└─ ✅ Ready
```

**Rules:**
- Each line = one phase, one status
- Use `—` separator between label and status
- Keep it to ~7 lines max
- If a phase had a warning/error, show it inline: `⚠️ van-management — missing AGENT.md`
- If boot is triggered by heartbeat, skip the log (heartbeats are silent)

**Examples:**

Typical boot:
```
🥝 dot-ai boot
├─ 🏠 Root context — loaded
├─ 📝 memory/2026-02-07.md — created (+yesterday loaded)
├─ 🧠 MEMORY.md — loaded
├─ 📁 6 projects, 22 skills
├─ 📋 projects-index.md — fresh (3d)
└─ ✅ Ready
```

Boot with index refresh + warning:
```
🥝 dot-ai boot
├─ 🏠 Root context — loaded
├─ 📝 memory/2026-02-07.md — loaded (+yesterday)
├─ 🧠 MEMORY.md — skipped (shared session)
├─ 📁 6 projects, 22 skills
├─ 📋 projects-index.md — regenerated (was 9d old)
├─ ⚠️ todo — missing AGENT.md frontmatter
└─ ✅ Ready
```

### Overview Format

See `dot-ai-workspace-scan` sub-skill for the scan process and output format.
The overview should be **compact** — typically under 300 tokens.

## Runtime — Prompt Routing

**This routing MUST be consulted for every prompt.** No exceptions.

When a prompt arrives:

1. **Route** — Consult `memory/projects-index.md` or the workspace overview. Which project does this relate to?
2. **Load** — If matched, read the full `AGENT.md` AND `TOOLS.md` of that project.
3. **Skill check** — Does a skill match the request? Read its full `SKILL.md`.
4. **Execute** — Perform the task with the loaded context.
5. **Save** — Write outputs to the project's `.ai/memory/` (notes) or `data/` (structured data), not to global memory.
6. **Global** — If no project matches, use root context and global skills.

### Routing Rules

- **ALWAYS route through dot-ai** — even if you "know" which project it is.
- NEVER load all projects at once. Load only what the prompt needs.
- When uncertain which project, ASK rather than guess.
- A single prompt can involve multiple projects (load both).
- Skills from root `.ai/skills/` are available globally, regardless of project.
- Skills from a project `.ai/skills/` are scoped to that project.

## Retrieval-Led Reasoning

**Never trust pre-trained memory for executing a workflow.**
Even if you "think you know" how to do it → **READ the SKILL.md first**.
Processes change, paths change, APIs change.
ALWAYS prefer retrieval-led reasoning over pre-training-led reasoning.

## Context Isolation — Global vs Project

### Principle
**Only load what's needed. Only save where it belongs.**

The root `.ai/` is for **cross-project** context only. Everything project-specific lives in the project.

### What stays GLOBAL (root `.ai/`)
- `AGENTS.md` — operating rules, conventions
- `SOUL.md`, `USER.md`, `IDENTITY.md` — identity
- `TOOLS.md` — **only** cross-project tools (e.g., Google/gogcli)
- `MEMORY.md` — curated long-term memory (no project-specific data)
- `memory/*.md` — daily session logs
- `skills/` — global skills (backlog, dot-ai, peer-review, etc.)

### What lives IN THE PROJECT (`projects/<name>/.ai/`)
- `AGENT.md` — project description, structure, rules
- `TOOLS.md` — project-specific tool config (e.g., HA access for van-management)
- `memory/` — project-scoped notes, research, investigation context
- `skills/` — project-specific skills
- `data/` — structured project data (backlogs, exports, JSON, reports)

### Rules
1. **Never store project data in global memory** — no `memory/tasks/<project>/`
2. **Never store project tool config in global TOOLS.md** — each project has its own
3. **Load project TOOLS.md on-demand** — only when routing to that project
4. **Sub-agents inherit project context** — spawn template must include project AGENT.md path
5. **Research outputs go to `projects/<name>/.ai/memory/`** — not global memory

### Context Loading Order (per project)
When routing to a project, load:
1. `projects/<name>/.ai/AGENT.md` (required)
2. `projects/<name>/.ai/TOOLS.md` (if exists)
3. Relevant skill `SKILL.md` (if triggered)
4. Relevant notes from `projects/<name>/.ai/memory/` (as needed)
5. Relevant data files from `projects/<name>/data/` (as needed)

## Memory Conventions

### Root memory
- `MEMORY.md` — curated long-term memory (main session only, private)
- `memory/YYYY-MM-DD.md` — daily logs (today + yesterday loaded at boot)

### Project memory
- `projects/<name>/.ai/MEMORY.md` — project-scoped curated memory
- `projects/<name>/.ai/memory/` — project-scoped notes, research, investigation

### Tasks (managed by `dot-ai-tasks`)

Task management uses the **same convention** at global and project level:
- `BACKLOG.md` — prioritized task index/overview (lightweight, quick scan)
- `tasks/<slug>.md` — detailed task notes, research, progress (loaded on-demand)

**Structure:**
```
# Global (cross-project tasks)
.ai/memory/tasks/
├── BACKLOG.md              ← Global task index
├── refactoring-dot-ai.md   ← Task details
└── kanban-dashboard.md     ← Task details

# Project tasks
projects/<name>/.ai/memory/tasks/
├── BACKLOG.md              ← Project task index
├── autoterm-2d.md          ← Task details
└── maxxfan-esp32.md        ← Task details
```

**Lifecycle:**
- BACKLOG.md = overview for routing (which tasks exist, priorities)
- tasks/<slug>.md = full context loaded when working on that task
- When task completed → mark done in BACKLOG.md, keep task file as reference
- Tasks can be short (quick fixes) or long (multi-session projects)
- No distinction "temporary vs permanent" — a task is a task

**Separation rationale:**
BACKLOG.md provides quick overview without loading all task details.
Similar to projects-index.md vs full AGENT.md — metadata first, details on-demand.

### Rules
- Project-specific notes → project's `.ai/memory/`, NEVER in root `memory/`
- Task tracking → `memory/tasks/` (both global and per-project)
- Facts and lessons → `MEMORY.md` (root, curated, no project-specific data)
- Daily session logs → `memory/YYYY-MM-DD.md` (root)

## Token Budget Guidelines

| Phase | Target |
|-------|--------|
| Boot (root context) | ~2000 tokens |
| Overview (all projects) | ~300 tokens |
| Project load (on-demand) | ~1000 tokens per project |
| Skill load (on-demand) | ~500-2000 tokens per skill |

The goal: minimal upfront cost, load details only when needed.

## Metadata Caching Strategy

**Philosophy: Generate once, use many times.**

Pre-generate lightweight metadata files for fast routing without full scans:

| Cache File | Purpose | Generated By | Used By | Update Trigger |
|------------|---------|--------------|---------|----------------|
| `.ai/memory/projects-index.md` | Project overview, skills list | `workspace-scan` | Boot, routing | Boot (if >7d old), audit drift |
| `.ai/memory/skills-index.json` | All skills with frontmatter | `workspace-scan` | Skill discovery | Boot, audit |
| `projects/<name>/.ai/data-index.json` | Data files summary (type, size, mtime) | `agent-sync` | Project routing | Data file changes, audit |
| `.ai/memory/activity-index.json` | Recent project modifications (last 30d) | `workspace-scan` | Smart routing | Daily, on-demand |
| `.ai/memory/deps-graph.json` | Project dependency graph (if Nx/monorepo) | `workspace-scan` | Impact analysis | Config changes, audit |

### Cache Benefits

1. **Fast routing** — Read index files instead of scanning workspace
2. **Reduced tokens** — Compact metadata vs full file contents
3. **Smart defaults** — Route to recently-active projects first
4. **Impact awareness** — Know which projects are affected by changes
5. **Offline-first** — Indexes work without file system access

### Cache Invalidation

- **Time-based**: Regenerate if >7 days old
- **Event-based**: File modifications in watched directories
- **Audit-based**: Drift detection triggers regeneration
- **Manual**: "rescan workspace", "rebuild indexes"

### Example: Smart Routing with Activity Index

```json
// .ai/memory/activity-index.json
{
  "lastUpdated": "2026-02-06T14:30:00Z",
  "projects": [
    {
      "name": "roule-caillou",
      "lastModified": "2026-02-06T12:00:00Z",
      "recentFiles": ["data/properties/_index.json", ".ai/skills/property-report/SKILL.md"],
      "activityScore": 0.95
    },
    {
      "name": "pro",
      "lastModified": "2026-02-04T10:00:00Z",
      "recentFiles": ["data/medium-digest/articles.json"],
      "activityScore": 0.42
    }
  ]
}
```

**Routing logic:**
```
User prompt: "montre-moi les derniers biens"

1. Read activity-index.json (fast, ~50 tokens)
2. Match keywords "biens" → roule-caillou (tags: immobilier, bien)
3. Check activityScore: 0.95 (recent activity) → high confidence
4. Load roule-caillou AGENT.md + relevant skill
5. Execute with loaded context
```

Without cache: would need to scan all 6 projects, read 40 skills → ~2000 tokens.
With cache: read 1 index file → ~50 tokens. **40x reduction.**

## Requirements

**Core:**
- Bash 4.0+
- Standard Unix tools: `find`, `grep`, `ls`, `cat`

**Optional (enhanced validation):**
- Python 3.8+ for YAML validation
- `jq` for JSON data processing

All tools should be available on macOS, Linux, and WSL.

## Sub-skills

⚠️ **Important: Sub-skills are internal components of dot-ai.**

They are marked with `internal: true` and should **NOT** be invoked directly by external orchestrators or user prompts. Always use the main `dot-ai` skill as the entry point — it will delegate to the appropriate sub-skill automatically.

**Correct usage:**
- ✅ `dot-ai` orchestrates and delegates to sub-skills
- ✅ Use `dot-ai` skill as main entry point

**Incorrect usage:**
- ❌ Directly invoking `dot-ai-audit` from user prompt
- ❌ Manually calling sub-skills outside dot-ai context

This skill uses sub-skills for specific operations.
Load the appropriate sub-skill when needed.

### Core Sub-skills

| Sub-skill | Description | Triggers |
|-----------|-------------|----------|
| `dot-ai-workspace-scan` | Scan `.ai/` directories, generate projects-index.md and in-memory overview | boot |
| `dot-ai-project-init` | Create new project with proper `.ai/` structure | manual |
| `dot-ai-tasks` | Task management, backlogs, task lifecycle, notes linking | always |
| `dot-ai-audit` | Weekly audit of workspace coherence, indexes, and paths | heartbeat |
| `dot-ai-security` | Security conventions, file permissions, prompt injection defense | boot, audit |
| `dot-ai-self-improve` | Auto-correction and knowledge documentation process | manual |
| `dot-ai-migrate` | Migrate workspace from old convention version to current | manual |
| `dot-ai-export` | Export workspace structure as JSON/YAML for external tools | manual |

### Sync Sub-skills (Validation & Generation)

Each file type has a dedicated sync sub-skill for validation and generation.
`dot-ai-audit` delegates to these sync skills for validation.

| Sub-skill | File Type | Responsibility |
|-----------|-----------|----------------|
| `dot-ai-agent-sync` | `AGENT.md` | Validate frontmatter, generate structure/data/skills sections |
| `dot-ai-skill-sync` | `SKILL.md` | Validate frontmatter (name, description, triggers) |
| `dot-ai-backlog-sync` | `BACKLOG.md` | Validate task list format, check orphan slugs |
| `dot-ai-memory-sync` | `MEMORY.md` | Validate structure (optional, light validation) |
| `dot-ai-tools-sync` | `TOOLS.md` | Validate tool definitions (optional) |

**Pattern:** Audit calls sync skills to validate, sync skills have authority on structure.

Sub-skills are located in `skills/<name>/SKILL.md` (sibling directories to `skills/dot-ai/`).
They **complement** this skill — they don't replace it. This file remains
the framework (conventions, structure, boot, routing). Sub-skills handle
the operational details.

## Sync — Native Tool Configuration

The `sync.sh` script updates native AI tool configuration files
to reference this skill. It uses comment markers for safe updates.

### Supported Tools

**Claude Code** (`CLAUDE.md`):
Uses native `@import` syntax.
```markdown
<!-- dot-ai start -->
@<path-to-skill>/SKILL.md
<!-- dot-ai end -->
```

**OpenAI Codex** (`AGENTS.md` at repo root):
Injects content between markers.
```markdown
<!-- dot-ai start -->
<!-- Auto-managed by dot-ai. Do not edit between markers. -->
Read and follow <path-to-skill>/SKILL.md for workspace conventions.
<!-- dot-ai end -->
```

**Windsurf** (`.windsurf/rules/dot-ai.md`):
Creates a rule file with activation mode "Always On".

**Cursor** (`.cursor/rules/dot-ai.md`):
Creates a rule file.

### Running Sync

```bash
# From anywhere in the workspace:
.ai/skills/dot-ai/sync.sh

# The script auto-detects:
# - Its own location (no hardcoded paths)
# - Which tools are present
# - The workspace root
```

### Marker Pattern

All injections use the same markers:
```
<!-- dot-ai start -->
...content...
<!-- dot-ai end -->
```

Content between markers is fully managed by sync.
Content outside markers is preserved and never touched.
