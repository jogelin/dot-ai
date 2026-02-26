# dot-ai Convention — Bootstrap (Minimal Context)

**This workspace follows the dot-ai convention.**
Full documentation: read `.ai/skills/dot-ai/SKILL.md` when needed.

## Core Structure

```
.ai/
├── AGENTS.md          # AI system documentation (MUST read on boot)
├── SOUL.md            # Workspace personality/behavior rules
├── USER.md            # User preferences and context
├── IDENTITY.md        # Project identity and vision
├── TOOLS.md           # Available tools and integrations
├── memory/
│   ├── YYYY-MM-DD.md          # Daily session notes
│   ├── projects-index.md      # Active projects routing map
│   └── tasks/                 # Cross-project task tracking
├── projects/
│   └── {project-name}/
│       └── .ai/               # Per-project AI context
└── skills/
    └── dot-ai/
        └── SKILL.md           # Full convention reference
```

## Boot Sequence (REQUIRED on SessionStart)

### Phase 1: Core Context (AUTO-LOADED)

The following files are **automatically loaded into the system prompt** via `@` imports in CLAUDE.md — no action needed:
- `AGENTS.md` — operational rules (security, git, memory)
- `SOUL.md` — personality, tone, limits
- `USER.md` — human context (Jo, family, projects)
- `IDENTITY.md` — project identity ("Kiwi")

### Phase 2: Session Context (MANDATORY — read BEFORE any response)

You **MUST** read these files at the start of every session, before responding to the user:

1. **Read TOOLS.md** — `Read .ai/TOOLS.md` (available tools and integrations)
2. **Load memory** — Read `memory/YYYY-MM-DD.md` for today + yesterday (if exists)
3. **Scan projects** — Quick overview of `projects/` structure
4. **Check routing** — Load `memory/projects-index.md` for project routing

## Task Management

**ALWAYS use `dot-ai-tasks` sub-skill** (NOT built-in todos):
- Default provider: file-based BACKLOG.md (`.ai/memory/tasks/`)
- Custom providers supported (e.g., Cockpit API in Kiwi workspace)
- Provider configured in `.ai/config.yaml` → `tasks.provider`
- Task details: `.ai/memory/tasks/{slug}.md` (on-demand, file provider)
- Project tasks: `projects/{name}/.ai/memory/tasks/`
- Use frontmatter: `status`, `priority`, `project`, `tags`

## Intelligent Routing (CRITICAL)

**EVERY request routes through analysis → optimal model dispatch**

### Core Rules
- **Opus = orchestrator only**, never execution
- **Auto-route** simple tasks to Haiku/Sonnet  
- **Auto-split** complex requests into optimal sub-tasks
- **NEVER spawn sub-agent without specifying model!**

### Quick Reference  
- Haiku (`claude-haiku`): file reads, data extraction, formatting
- Sonnet (`claude-sonnet`): research, development, analysis  
- Opus (`claude-opus`): planning, architecture, coordination only

**Full routing logic:** Read `skills/intelligent-routing/SKILL.md`

**Fallback manual rules:** Read `skills/model-selection/SKILL.md` + `skills/context-strategy/SKILL.md`

## Data Separation Rule

**`.ai/data/` = structured exploitable data ONLY**
- ✅ CSVs, JSON exports, database dumps
- ❌ Research notes, drafts, temporary files
- Research goes in `memory/research/`, drafts in `memory/drafts/`

## Available Sub-Skills

Invoke via skill matching (auto-detected) or explicit:
- `intelligent-routing` - Auto-analyze and route ALL requests (CORE)
- `dot-ai-tasks` - Task management (ALWAYS use this)
- `dot-ai-workspace-scan` - Rebuild projects index
- `dot-ai-project-init` - Initialize new project .ai/ structure
- `dot-ai-audit` - Workspace coherence validation
- `dot-ai-security` - Security rules and verification
- `model-selection` - Manual model selection rules (fallback)
- `context-strategy` - Context budget management (fallback)

**For full details:** Read `.ai/skills/dot-ai/SKILL.md` (~570 lines, load on-demand)

## Quick Reference

- **Request routing**: `intelligent-routing` auto-analyzes ALL requests
- **Projects routing**: Check `memory/projects-index.md` first  
- **Task tracking**: Use `dot-ai-tasks`, NOT built-in todos
- **Model hierarchy**: Haiku execution, Sonnet dev, Opus orchestration
- **Boot sequence**: AGENTS.md → SOUL → USER → IDENTITY → TOOLS
- **Memory**: Today + yesterday session notes

---

**Token optimization**: This bootstrap is ~100 lines. Full SKILL.md is 571 lines.
**When to read full SKILL.md**: User asks "how does X work", you need detailed rules, or debugging conventions.
