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

1. **Find root .ai/** - Look upward from workspace, stop at first .ai/ with AGENTS.md
2. **Load core docs** - Read in order: AGENTS.md → SOUL.md → USER.md → IDENTITY.md → TOOLS.md
3. **Load memory** - Read `memory/YYYY-MM-DD.md` for today + yesterday (if exists)
4. **Scan projects** - Quick overview of `projects/` structure
5. **Check routing** - Load `memory/projects-index.md` for project routing

## Task Management

**ALWAYS use `dot-ai-tasks` sub-skill** (NOT built-in todos):
- Global backlog: `.ai/memory/BACKLOG.md` (lightweight index)
- Task details: `.ai/memory/tasks/{slug}.md` (on-demand)
- Project tasks: `projects/{name}/.ai/memory/tasks/`
- Use frontmatter: `status`, `priority`, `project`, `tags`

## Model Selection (CRITICAL)

**NEVER spawn sub-agent without specifying model!**

| Task Type | Model | When |
|-----------|-------|------|
| Extraction, OCR, formatting, bulk ops | **Haiku** (`anthropic/claude-haiku`) | Cheap execution |
| Development, refactoring, research | **Sonnet** (`anthropic/claude-sonnet-4`) | Standard work |
| Architecture, complex reasoning | **Opus** (`anthropic/claude-opus-4-6`) | Strategic only |

### Anti-patterns
- ❌ Default model without explicit choice
- ❌ Opus for execution tasks
- ❌ Multiple web_fetch in Opus (delegate to Sonnet)
- ❌ 5+ concurrent sub-agents without rate check

**Full details:** Read `skills/model-selection/SKILL.md`

## Context Management

Monitor context usage and delegate proactively:

| Context Usage | Action |
|---------------|--------|
| <50% | Normal operation |
| 50-70% | Delegate reads to sub-agents |
| >70% | Switch to Sonnet if on Opus |
| >85% | Stop reading, work from memory |

**Full details:** Read `skills/context-strategy/SKILL.md`

## Data Separation Rule

**`.ai/data/` = structured exploitable data ONLY**
- ✅ CSVs, JSON exports, database dumps
- ❌ Research notes, drafts, temporary files
- Research goes in `memory/research/`, drafts in `memory/drafts/`

## Available Sub-Skills

Invoke via skill matching (auto-detected) or explicit:
- `dot-ai-tasks` - Task management (ALWAYS use this)
- `dot-ai-workspace-scan` - Rebuild projects index
- `dot-ai-project-init` - Initialize new project .ai/ structure
- `dot-ai-audit` - Workspace coherence validation
- `dot-ai-security` - Security rules and verification
- `model-selection` - Which model for which task
- `context-strategy` - Context budget management

**For full details:** Read `.ai/skills/dot-ai/SKILL.md` (~570 lines, load on-demand)

## Quick Reference

- **Projects routing**: Check `memory/projects-index.md` first
- **Task tracking**: Use `dot-ai-tasks`, NOT built-in todos
- **Model choice**: Haiku execution, Sonnet dev, Opus strategy
- **Boot sequence**: AGENTS.md → SOUL → USER → IDENTITY → TOOLS
- **Memory**: Today + yesterday session notes

---

**Token optimization**: This bootstrap is ~100 lines. Full SKILL.md is 571 lines.
**When to read full SKILL.md**: User asks "how does X work", you need detailed rules, or debugging conventions.
