# dot-ai — Universal AI Workspace Convention

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.5.2-green.svg)](package.json)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-compatible-purple.svg)](https://github.com/openclaw/openclaw)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-blue.svg)](https://claude.ai/claude-code)

> **A standardized `.ai/` workspace structure for AI assistants — dual plugin for OpenClaw and Claude Code.**

The dot-ai convention provides a universal workspace structure that helps AI assistants understand your project context, manage tasks, route between projects, and maintain consistency across sessions.

---

## ✨ Features

- 🏗️ **Workspace Structure** — Standardized `.ai/` directory with boot sequence and project routing
- ✅ **Task Management** — TaskProvider pattern (Cockpit API, file-based, or custom) that replaces built-in todos
- 🎯 **Model Selection** — Smart routing between Haiku/Sonnet/Opus to optimize costs
- 📊 **Token Budget** — Auto-trims skills/memories to fit context window with BudgetWarning diagnostics
- 🔧 **Capabilities** — Interactive tools (memory_recall, task_list, etc.) defined once in core, mapped by adapters
- 🪝 **Hooks** — 4 pipeline extension points (after_boot, after_enrich, after_format, after_learn)
- 🔍 **Health Monitoring** — Built-in diagnostics and troubleshooting (doctor skill)
- 🚀 **DotAiRuntime** — Single class encapsulating the full pipeline (boot, enrich, format, learn)
- 🔄 **Progressive Loading** — Overview at startup, skill content loaded on-demand

---

## 📦 Installation

### Claude Code

```bash
# Install the plugin
claude plugin add dot-ai
```

### npm Packages

For programmatic use or custom adapters:

```bash
npm install @dot-ai/core @dot-ai/adapter-claude
```

Available packages: `@dot-ai/core`, `@dot-ai/adapter-claude`, `@dot-ai/file-memory`, `@dot-ai/file-skills`, `@dot-ai/file-identity`, `@dot-ai/file-tools`, `@dot-ai/file-tasks`, `@dot-ai/rules-routing`, `@dot-ai/sqlite-memory`, `@dot-ai/cli`

### OpenClaw

```bash
openclaw plugins install dot-ai
openclaw gateway restart
```

### Other AI Tools (Windsurf, Cursor, Continue.dev, Codex)

Use the adapter-sync package to generate agent-specific configuration:

```bash
npx @dot-ai/adapter-sync
```

This generates:
- **Windsurf:** `.windsurf/rules/dot-ai.md`
- **Cursor:** `.cursor/rules/dot-ai.md`
- **Codex:** Injects into root `AGENTS.md`
- **Continue.dev:** Manual reference in `.continuerc.json`

---

## 🚀 Quick Start

### 1. Create Workspace Structure

```bash
mkdir -p my-project/.ai/memory/tasks
cd my-project/.ai
```

### 2. Create Minimum Required File

Create `.ai/AGENTS.md`:

```markdown
# AGENTS.md

This workspace follows the dot-ai convention.

## Project

{Brief description of your project}

## Conventions

- Read `.ai/skills/dot-ai/BOOTSTRAP.md` for workspace rules
- Use `dot-ai-tasks` for task management (not built-in todos)
- Follow model routing guidelines
```

### 3. Plugin Auto-Detection

The plugin automatically detects any workspace with `.ai/AGENTS.md` and:
- ✅ Loads workspace context at session start
- ✅ Enforces task management conventions
- ✅ Optimizes model selection for sub-agents
- ✅ Provides access to all skills

**No local installation needed** — the plugin provides skills globally!

---

## 📚 Complete Skill Reference

### Core Skills (4)

| Skill | Purpose | Triggers |
|-------|---------|----------|
| **dot-ai** | Main workspace convention | `manual` |
| **dot-ai-tasks** | Task management (use instead of todos) | `always` |
| **model-selection** | Smart model routing (Haiku/Sonnet/Opus) | `always` |
| **context-strategy** | Context budget management (<50%, >70%, >85%) | `always` |

### Project & Workspace (3)

| Skill | Purpose | Triggers |
|-------|---------|----------|
| **dot-ai-workspace-scan** | Scan .ai/ directories, build project index | `boot`, manual |
| **dot-ai-project-init** | Create new project with proper structure | manual |
| **dot-ai-migrate** | Migrate from older convention versions | manual, auto-detect |

### Validation & Sync (6)

| Skill | Purpose | Triggers |
|-------|---------|----------|
| **dot-ai-audit** | Weekly workspace coherence validation | `heartbeat`, manual |
| **dot-ai-agent-sync** | Generate/maintain AGENT.md sections | manual, audit |
| **dot-ai-skill-sync** | Validate SKILL.md frontmatter | audit |
| **dot-ai-backlog-sync** | Validate task structure | audit |
| **dot-ai-memory-sync** | Validate memory/ directory structure | audit |
| **dot-ai-tools-sync** | Validate TOOLS.md structure | audit |

### Utilities (4)

| Skill | Purpose | Triggers |
|-------|---------|----------|
| **dot-ai-export** | Export workspace as JSON/YAML/Markdown | manual |
| **dot-ai-doctor** | Health checks and troubleshooting | manual, on errors |
| **dot-ai-security** | Security rules and verification | `always` |
| **dot-ai-self-improve** | Learning loop and pattern extraction | manual |

**See `openclaw.plugin.json` for the full skill list.**

---

## 🏗️ Workspace Structure

```
my-project/
├── .ai/                        # Root workspace context
│   ├── AGENTS.md               # Required — AI operating rules
│   ├── SOUL.md                 # Optional — Workspace personality
│   ├── USER.md                 # Optional — User preferences
│   ├── IDENTITY.md             # Optional — Project identity
│   ├── TOOLS.md                # Optional — Tool configuration
│   │
│   ├── memory/                 # Session memory and tasks
│   │   ├── YYYY-MM-DD.md       # Daily session notes
│   │   ├── tasks/              # Task details (on-demand)
│   │   │   └── {slug}.md
│   │   └── research/           # Research notes
│   │
│   ├── data/                   # Structured data ONLY (no drafts!)
│   │   ├── exports/            # Generated exports (CSV, JSON)
│   │   └── imports/            # External data imports
│   │
│   └── skills/
│       └── dot-ai/             # Symlink to plugin skills (auto-created)
│           ├── BOOTSTRAP.md    # Lightweight startup context
│           ├── SKILL.md        # Full documentation
│           ├── CONVENTIONS.md  # Shared conventions
│           └── templates/      # Reusable templates
│
└── projects/                   # Sub-projects (optional)
    └── {project-name}/
        └── .ai/                # Per-project AI context
            ├── AGENT.md        # Project-specific docs
            └── memory/
                └── tasks/
```

### Key Principles

- **Root `.ai/`** — Workspace-wide context
- **Project `.ai/`** — Project-specific context
- **Data Separation** — `.ai/data/` = structured only, no research/drafts
- **Memory Organization** — Daily notes, tasks, research separated
- **Auto-Generation** — Files between `<!-- dot-ai-{skill} start/end -->` markers managed automatically

---

## 🎯 Usage Examples

### Task Management

**Always use `dot-ai-tasks` instead of built-in todos.**

Tasks are managed through the **TaskProvider** contract. The provider can be backed by:
- **Cockpit API** (`@dot-ai/cockpit-tasks`) — REST API at `http://localhost:3010`
- **File-based** (`@dot-ai/file-tasks`) — JSON files in `.ai/memory/tasks/`
- **Custom** — Any implementation of the `TaskProvider` interface

Configure in `.ai/dot-ai.yml`:

```yaml
tasks:
  use: '@dot-ai/cockpit-tasks'
  with:
    url: 'http://localhost:3010'
    apiKey: '${COCKPIT_API_KEY}'
```

Tasks support standard fields: `id`, `text`, `status`, `priority`, `project`, `tags`.

### Model Selection

The plugin automatically injects model routing rules:

```
Task Type                  →  Model to Use
─────────────────────────────────────────────────
OCR, extraction, formatting  →  Haiku (cheap)
Development, refactoring     →  Sonnet (standard)
Architecture, planning       →  Opus (strategic only)
```

**Anti-patterns:**
- ❌ Never spawn sub-agent without specifying model
- ❌ Never use Opus for execution tasks
- ❌ Never do multiple web_fetch in Opus

### Context Management

The plugin monitors context usage and suggests delegation:

```
Context Usage  →  Action
───────────────────────────────────────
< 50%          →  Normal operation
50-70%         →  Delegate reads to sub-agents
> 70%          →  Switch to Sonnet if on Opus
> 85%          →  Stop reading, work from memory
```

### Health Checks

Run workspace diagnostics:

```
"doctor" or "health check"
```

Output:
```
🏥 dot-ai Health Check

Overall Health: 85/100 (Good)

✅ Passed (5):
  - Structure validation
  - Required files
  - Symlinks valid
  - Cache fresh (<7 days)
  - Disk space OK

⚠️ Warnings (2):
  - 3 orphan tasks without backlog refs
  - 5 untracked files in .ai/

💊 Suggested Fixes:
  1. Run backlog-sync to add orphan tasks
  2. Run `git add .ai/` to track files
```

### Project Initialization

Create a new project with proper structure:

```
"create project backend" or "init project backend"
```

Generates:
```
projects/backend/
└── .ai/
    ├── AGENT.md (with auto-generated sections)
    └── memory/
        ├── BACKLOG.md
        └── tasks/
```

---

## 🏛️ Architecture

### Engine Architecture (v4.2)

```
Agent (Claude Code / OpenClaw / Custom)
  └── Adapter (hooks into native events)
        └── DotAiRuntime (@dot-ai/core)
              ├── boot()           → cache identities + vocabulary
              ├── processPrompt()  → enrich + format + hooks
              ├── learn()          → store in memory
              └── flush()          → flush logger

  Providers (pluggable):        Capabilities (tools):
  ├── Memory (sqlite, file)     ├── memory_recall
  ├── Skills (file)             ├── memory_store
  ├── Identity (file)           ├── task_list
  ├── Routing (rules)           ├── task_create
  ├── Tasks (cockpit, file)     └── task_update
  └── Tools (file)

  Hooks: after_boot → after_enrich → after_format → after_learn
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full technical reference.

### INDEX/SKILL Pattern

All large skills (>100 lines) use INDEX/SKILL separation:

- **INDEX.md** (~30-40 lines) — Quick reference at startup
  - Purpose and triggers
  - Quick commands
  - Key concepts
  - Use cases
  - Pointer to SKILL.md

- **SKILL.md** (full docs) — Loaded on-demand
  - Detailed procedures
  - Examples and edge cases
  - Templates and validation rules
  - Integration points

**Benefits:**
- ✅ Fast startup (agent sees overview)
- ✅ Complete awareness (knows what exists)
- ✅ Progressive loading (details when needed)

### Shared Infrastructure

- **CONVENTIONS.md** — Single source of truth for:
  - Marker patterns
  - Frontmatter schema
  - Output formats
  - Validation workflows
  - Directory structure

- **templates/** — Reusable templates:
  - BACKLOG.template.md
  - AGENT.template.md
  - SKILL.template.md
  - task-details.template.md
  - validation-output.template.md

---

## 🔧 Configuration

### OpenClaw Configuration

The plugin respects OpenClaw's plugin configuration:

```json
{
  "plugins": {
    "dot-ai": {
      "workspaceRoot": "~/dev/my-workspace",
      "modelRouting": {
        "enabled": true,
        "defaultSubagentModel": "anthropic/claude-haiku",
        "maxConcurrentSubagents": 8
      }
    }
  }
}
```

### Claude Code Configuration

Uses `.claude-plugin/plugin.json` for metadata and skill registration.

---

## 📖 Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Full v4.2 architecture (engine, providers, capabilities, hooks, token budget)
- **[BOOTSTRAP.md](skills/dot-ai/BOOTSTRAP.md)** — Lightweight startup context (what agent sees at boot)
- **[dot-ai-architecture skill](skills/dot-ai-architecture/)** — Architecture comprehension skill for AI agents
- **[SKILL.md](skills/dot-ai/SKILL.md)** — Full dot-ai convention documentation
- **[CONVENTIONS.md](skills/dot-ai/CONVENTIONS.md)** — Shared conventions across all skills

---

## 🤝 Contributing

### Adding New Skills

1. Create skill directory: `skills/my-skill/`
2. Create INDEX.md (~30 lines) with overview
3. Create SKILL.md with full documentation
4. Add skill to manifests:
   - `openclaw.plugin.json` → `skills` array
   - `.claude-plugin/plugin.json` → `skills` array
5. Update plugin injection in `index.ts` if needed

### Skill Development Guidelines

- Follow INDEX/SKILL pattern for skills >100 lines
- Reference CONVENTIONS.md for shared patterns
- Use templates from `templates/` directory
- Include frontmatter with name, description, triggers
- Add cross-references to related skills
- Write clear examples and use cases

### Template Usage

Use existing templates for consistency:
- Project docs → AGENT.template.md
- New skills → SKILL.template.md

---

## 🐛 Troubleshooting

### Plugin Not Loading

```bash
# OpenClaw
openclaw plugins list
openclaw gateway restart

# Claude Code
claude plugin list
claude plugin enable dot-ai
```

### Workspace Not Detected

Check that `.ai/AGENTS.md` exists:

```bash
ls -la .ai/
```

If missing, create it or run:

```
"init project {name}"
```

### Health Check Failed

Run diagnostics:

```
"doctor" or "health check"
```

Follow suggested fixes from the output.

### Skills Not Available

The plugin provides skills globally. If skills aren't working:

1. Verify plugin is enabled
2. Restart agent/gateway
3. Check workspace has `.ai/AGENTS.md`

---

## 📊 Performance

### Token Optimization

**Startup injection:**
- Before optimization: 1582 lines
- After optimization: 620 lines
- **Reduction: 61% (962 lines saved)**

**Strategy:**
- INDEX.md files provide overview (520 lines)
- SKILL.md files loaded on-demand (1600+ lines)
- Agent maintains 100% awareness with 61% fewer tokens

**Impact:**
- ✅ Faster OpenClaw startup
- ✅ More context budget for actual work
- ✅ Same functionality, better performance

---

## 📄 License

MIT License — See [LICENSE](LICENSE) for details.

---

## 🔗 Links

- **Repository:** https://github.com/jogelin/dot-ai
- **Issues:** https://github.com/jogelin/dot-ai/issues
- **OpenClaw:** https://github.com/openclaw/openclaw
- **Claude Code:** https://claude.ai/claude-code

---

## 🎯 Summary

**dot-ai** provides a universal workspace convention for AI assistants:

- ✅ Standardized `.ai/` structure with multi-project support
- ✅ 6 provider contracts (memory, skills, identity, routing, tasks, tools)
- ✅ DotAiRuntime for easy adapter integration
- ✅ 5 interactive capabilities (memory_recall/store, task_list/create/update)
- ✅ 4 pipeline hooks for extensibility
- ✅ Token budget with auto-trimming
- ✅ Deterministic label-based matching (no LLM in pipeline)
- ✅ Works with Claude Code, OpenClaw, Cursor, Copilot

**Get started:** Create `.ai/AGENTS.md` in your project root and let the plugin handle the rest!

---

**Made with ❤️ by the dot-ai community**

*Version 0.5.2 — Last updated: 2026-03-05*
