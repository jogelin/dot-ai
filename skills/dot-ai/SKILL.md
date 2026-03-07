---
name: dot-ai
description: Universal AI workspace convention. Discovery, structure, boot, routing. Use when bootstrapping a session, navigating workspace structure, managing projects, or understanding dot-ai conventions.
triggers: [manual]
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

dot-ai v4 handles boot programmatically via the adapter hook:

1. **Load config**: Read `.ai/settings.json` for extension configuration
2. **Discover nodes**: Scan `projects/*/` for `.ai/` directories (configurable via `workspace.scanDirs`)
3. **Boot providers**: Load identities, skills, build vocabulary
4. **Ready**: Vocabulary-based label matching routes prompts to relevant skills

The boot log and manual file scanning described below is for reference only — v4 automates this via `@dot-ai/core` engine.

## Runtime — Prompt Routing

dot-ai v4 handles routing automatically:

1. **Label extraction** — Extract labels from user prompt using vocabulary built at boot
2. **Skill matching** — Match labels to skill labels/triggers
3. **Memory search** — Search relevant memories via provider
4. **Context assembly** — Build enriched context (identities, skills, memories, tools, routing)
5. **Format** — Format as markdown for injection into agent context

Manual routing via `projects-index.md` is no longer needed.

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

### Rules
- Project-specific notes → project's `.ai/memory/`, NEVER in root `memory/`
- Facts and lessons → `MEMORY.md` (root, curated, no project-specific data)
- Daily session logs → `memory/YYYY-MM-DD.md` (root)
- Tasks → Cockpit API via `dot-ai-tasks` skill (not file-based BACKLOG.md)

## Token Budget Guidelines

| Phase | Target |
|-------|--------|
| Boot (root context) | ~2000 tokens |
| Overview (all projects) | ~300 tokens |
| Project load (on-demand) | ~1000 tokens per project |
| Skill load (on-demand) | ~500-2000 tokens per skill |

The goal: minimal upfront cost, load details only when needed.


## Requirements

**Core:**
- Bash 4.0+
- Standard Unix tools: `find`, `grep`, `ls`, `cat`

**Optional (enhanced validation):**
- Python 3.8+ for YAML validation
- `jq` for JSON data processing

All tools should be available on macOS, Linux, and WSL.

## Related Skills

| Skill | Purpose |
|-------|---------|
| `dot-ai-audit` | Workspace convention audit (cron, manual) |
| `dot-ai-tasks` | Task lifecycle via Cockpit API |

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
