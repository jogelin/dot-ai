# dot-ai plugin

Universal AI workspace convention — dual plugin for **OpenClaw** and **Claude Code**.

## What is dot-ai?

A `.ai/` directory is a standardized workspace for AI assistants.
It contains everything an AI needs to understand and work within a project:
identity, rules, memory, skills, and project context.

dot-ai provides:
- **Workspace structure** — `.ai/` convention with boot sequence and project routing
- **Task management** — BACKLOG.md + tasks/ pattern for tracking work
- **Model routing** — Smart model selection to optimize costs and avoid rate limits
- **Context enforcement** — Hooks that inject rules automatically (no drift)

## Installation

### OpenClaw

```bash
openclaw plugins install dot-ai
openclaw gateway restart
```

### Claude Code

```bash
claude plugin install /path/to/dot-ai-plugin
# or from npm:
claude plugin install dot-ai
```

### Windsurf / Cursor / Continue.dev / Codex

These tools don't have a plugin system — use the sync script instead:

```bash
./scripts/sync.sh
```

This generates:
- Windsurf: `.windsurf/rules/dot-ai.md`
- Cursor: `.cursor/rules/dot-ai.md`
- Codex: Injects into `AGENTS.md` (root level)
- Continue.dev: Manual reference in `.continuerc.json`

## What's Included

### Skills (13)

| Skill | Description |
|-------|-------------|
| `dot-ai` | Main convention — structure, boot, routing |
| `dot-ai-tasks` | Task management, backlogs, lifecycle |
| `dot-ai-workspace-scan` | Scan .ai/ directories, generate overview |
| `dot-ai-project-init` | Create new project with proper structure |
| `dot-ai-audit` | Weekly workspace coherence check |
| `dot-ai-security` | Security conventions and audit |
| `dot-ai-self-improve` | Auto-correction process |
| `dot-ai-agent-sync` | Generate/maintain AGENT.md |
| `dot-ai-skill-sync` | Validate SKILL.md structure |
| `dot-ai-backlog-sync` | Validate BACKLOG.md structure |
| `dot-ai-migrate` | Migrate from old convention versions |
| `dot-ai-export` | Export workspace as JSON/YAML |
| `model-routing` | Smart model selection and cost optimization |

### Hooks

#### OpenClaw (`agent:bootstrap`)
- **dot-ai-enforce** — Injects workspace convention into every session
- **model-routing** — Injects model selection rules

#### Claude Code
- **SessionStart** — Triggers dot-ai boot sequence
- **SubagentStart** — Enforces model selection on sub-agents

## Quick Start

After installing the plugin:

1. Create a `.ai/` directory in your project root
2. Add an `AGENTS.md` file (minimum requirement)
3. The plugin will automatically:
   - Detect the dot-ai workspace structure
   - Load the workspace context at session start
   - Enforce task management conventions
   - Optimize model selection for sub-agents

**Note:** The plugin automatically detects any workspace with a `.ai/AGENTS.md` file. You don't need to install the dot-ai skills locally - the plugin provides them globally.

## Workspace Structure

```
my-project/
├── .ai/
│   ├── AGENTS.md        # Operating rules
│   ├── SOUL.md          # Persona and tone
│   ├── USER.md          # Human context
│   ├── IDENTITY.md      # Agent identity
│   ├── TOOLS.md         # Tool configuration
│   ├── MEMORY.md        # Long-term memory
│   ├── memory/          # Daily notes
│   │   ├── YYYY-MM-DD.md
│   │   └── tasks/
│   │       ├── BACKLOG.md
│   │       └── <slug>.md
│   ├── skills/          # Custom skills
│   └── data/            # Structured data ONLY
├── projects/
│   └── <name>/
│       ├── .ai/         # Same convention, scoped
│       └── data/        # Project data
```

## License

MIT
