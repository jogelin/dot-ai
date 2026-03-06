# dot-ai — Universal AI Workspace Convention

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-5.0.0-green.svg)](package.json)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-compatible-purple.svg)](https://github.com/openclaw/openclaw)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-blue.svg)](https://claude.ai/claude-code)
[![Pi](https://img.shields.io/badge/Pi-compatible-orange.svg)](https://github.com/jogelin/dot-ai)

> **A standardized `.ai/` workspace structure for AI assistants — with a pluggable extension system for Claude Code, OpenClaw, Pi, Cursor, and Copilot.**

The dot-ai convention provides a universal workspace structure that helps AI assistants understand your project context, manage tasks, route between projects, and maintain consistency across sessions. v5 introduces a powerful **extension system** for tool gating, context injection, and custom behaviors.

---

## ✨ Features

- 🏗️ **Workspace Structure** — Standardized `.ai/` directory with boot sequence and project routing
- 🧩 **Extension System** — User-authored TypeScript extensions for tool gating, context injection, and custom tools
- ✅ **Task Management** — TaskProvider pattern (Cockpit API, file-based, or custom) that replaces built-in todos
- 🎯 **Model Selection** — Smart routing between Haiku/Sonnet/Opus to optimize costs
- 📊 **Token Budget** — Auto-trims skills/memories to fit context window with BudgetWarning diagnostics
- 🔧 **Capabilities** — Interactive tools (memory_recall, task_list, etc.) defined once in core, mapped by adapters
- 🧱 **7 Provider Contracts** — Memory, Skills, Identity, Routing, Tasks, Tools, and Prompts
- 🔍 **Health Monitoring** — Built-in diagnostics for extensions, providers, and troubleshooting
- 🚀 **DotAiRuntime** — Single class encapsulating boot, processPrompt, fireToolCall, learn, shutdown, and diagnostics
- 🔄 **Progressive Loading** — Overview at startup, skill content loaded on-demand
- 📡 **Two-Tier Events** — Universal events (all adapters) and rich events (full-featured adapters only)

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

Available packages:

| Package | Description |
|---------|-------------|
| `@dot-ai/core` | Runtime engine, extension loader, provider contracts |
| `@dot-ai/adapter-claude` | Claude Code adapter |
| `@dot-ai/pi` | Pi adapter (full event support) |
| `@dot-ai/adapter-sync` | Cursor / Copilot / Windsurf sync adapter |
| `@dot-ai/adapter-openclaw` | OpenClaw adapter |
| `@dot-ai/provider-sqlite-memory` | SQLite-backed memory provider |
| `@dot-ai/provider-file-memory` | File-backed memory provider |
| `@dot-ai/provider-file-skills` | File-based skills provider |
| `@dot-ai/provider-file-identity` | File-based identity provider |
| `@dot-ai/provider-file-tools` | File-based tools provider |
| `@dot-ai/provider-file-tasks` | File-based tasks provider |
| `@dot-ai/provider-file-prompts` | File-based prompts provider |
| `@dot-ai/provider-rules-routing` | Rules-based routing provider |
| `@dot-ai/cli` | CLI for workspace management |

### OpenClaw

```bash
openclaw plugins install dot-ai
openclaw gateway restart
```

### Other AI Tools (Windsurf, Cursor, Copilot, Continue.dev)

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
- ✅ Loads and activates extensions from `.ai/extensions/`
- ✅ Enforces task management conventions
- ✅ Optimizes model selection for sub-agents
- ✅ Provides access to all skills and capabilities

**No local installation needed** — the plugin provides skills globally!

---

## 🧩 Extension System

Extensions let you customize dot-ai behavior without modifying core code. Place TypeScript files in `.ai/extensions/` and they are loaded automatically at boot.

### Writing an Extension

```typescript
// .ai/extensions/security-gate.ts
import type { DotAiExtensionAPI } from '@dot-ai/core';

export default function(api: DotAiExtensionAPI) {
  api.on('tool_call', async (event) => {
    if (event.tool === 'Write' && event.input.file_path?.toString().endsWith('.env')) {
      return { decision: 'block', reason: 'Cannot write to .env files' };
    }
  });

  api.on('context_inject', async () => {
    return { inject: '> Always write tests for new features.' };
  });
}
```

### Extension Events

Events are split into two tiers based on adapter capability:

| Event | Tier | Description |
|-------|------|-------------|
| `context_inject` | Universal (Tier 1) | Inject text into prompt context |
| `tool_call` | Universal (Tier 1) | Gate or modify tool calls before execution |
| `agent_end` | Universal (Tier 1) | React when an agent completes |
| `context_modify` | Rich (Tier 2) | Modify assembled context before sending |
| `tool_result` | Rich (Tier 2) | Intercept or transform tool results |

Extensions can also register **custom tools** that appear alongside built-in capabilities.

### Adapter Capability Matrix

Not all adapters support every event. The matrix below shows what each adapter can fire:

| Adapter | context_inject | tool_call | agent_end | context_modify | tool_result |
|---------|:-:|:-:|:-:|:-:|:-:|
| **Pi** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Claude Code** | ✅ | ✅ | ✅ | — | — |
| **OpenClaw** | ✅ | — | ✅ | — | — |
| **Cursor/Copilot (sync)** | ✅ | — | — | — | — |

See [docs/extensions.md](docs/extensions.md) for the full extension authoring guide.

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
│   ├── extensions/             # User-authored extensions (v5)
│   │   └── *.ts                # Loaded automatically at boot
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
- **Extensions** — `.ai/extensions/` loaded at boot, gated by adapter capabilities
- **Data Separation** — `.ai/data/` = structured only, no research/drafts
- **Memory Organization** — Daily notes, tasks, research separated

---

## 🎯 Usage Examples

### Task Management

**Always use `dot-ai-tasks` instead of built-in todos.**

Tasks are managed through the **TaskProvider** contract. The provider can be backed by:
- **Cockpit API** (`@dot-ai/cockpit-tasks`) — REST API at `http://localhost:3010`
- **File-based** (`@dot-ai/provider-file-tasks`) — JSON files in `.ai/memory/tasks/`
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
  - Extension loading
  - Provider connectivity
  - Cache fresh (<7 days)

⚠️ Warnings (2):
  - 3 orphan tasks without backlog refs
  - 1 extension failed to load (syntax error)

💊 Suggested Fixes:
  1. Run backlog-sync to add orphan tasks
  2. Check .ai/extensions/ for syntax errors
```

---

## 🏛️ Architecture

### Engine Architecture (v5)

```
Agent (Claude Code / OpenClaw / Pi / Cursor / Copilot)
  └── Adapter (hooks into native events)
        └── DotAiRuntime (@dot-ai/core)
              ├── boot()           → cache + load extensions + session_start
              ├── processPrompt()  → enrich + format + context_inject
              ├── fireToolCall()   → extension-based tool gating
              ├── learn()          → memory + agent_end
              ├── shutdown()       → session_end + flush
              └── diagnostics      → extension + provider status

  Providers (pluggable):        Extensions (.ai/extensions/):
  ├── Memory (sqlite, file)     ├── context_inject (tier 1)
  ├── Skills (file)             ├── tool_call (tier 1)
  ├── Identity (file)           ├── agent_end (tier 1)
  ├── Routing (rules)           ├── context_modify (tier 2)
  ├── Tasks (cockpit, file)     ├── tool_result (tier 2)
  ├── Tools (file)              └── Custom tools
  └── Prompts (file)

  Capabilities (tools):
  ├── memory_recall / memory_store
  ├── task_list / task_create / task_update
  └── + extension-registered tools
```

See [docs/architecture.md](docs/architecture.md) for the full technical reference.

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

### dot-ai.yml

The central configuration file at `.ai/dot-ai.yml`:

```yaml
# Provider configuration
tasks:
  use: '@dot-ai/provider-file-tasks'

memory:
  use: '@dot-ai/provider-sqlite-memory'

# Prompts provider (v5)
prompts:
  use: '@dot-ai/provider-file-prompts'

# Extensions (v5)
extensions:
  enabled: true
  path: '.ai/extensions'
```

### OpenClaw Configuration

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

- **[docs/architecture.md](docs/architecture.md)** — Full v5 architecture (engine, providers, extensions, capabilities, events)
- **[docs/extensions.md](docs/extensions.md)** — Extension authoring guide (events, custom tools, best practices)
- **[BOOTSTRAP.md](skills/dot-ai/BOOTSTRAP.md)** — Lightweight startup context (what agent sees at boot)
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

### Writing Extensions

1. Create a `.ts` file in `.ai/extensions/`
2. Export a default function that receives `DotAiExtensionAPI`
3. Register handlers for events (`context_inject`, `tool_call`, `agent_end`, etc.)
4. Extensions are loaded automatically at boot — no registration needed

### Skill Development Guidelines

- Follow INDEX/SKILL pattern for skills >100 lines
- Reference CONVENTIONS.md for shared patterns
- Use templates from `templates/` directory
- Include frontmatter with name, description, triggers
- Add cross-references to related skills
- Write clear examples and use cases

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

### Extension Not Loading

Check the diagnostics output:

```
"doctor" or "health check"
```

Common issues:
- Syntax error in `.ts` file
- Missing default export
- Listening to events not supported by current adapter

### Health Check Failed

Run diagnostics and follow suggested fixes from the output.

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
- ✅ Faster startup across all adapters
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
- ✅ 7 provider contracts (memory, skills, identity, routing, tasks, tools, prompts)
- ✅ Extension system for tool gating, context injection, and custom tools
- ✅ DotAiRuntime with boot, processPrompt, fireToolCall, learn, shutdown, and diagnostics
- ✅ Two-tier event model (universal + rich) for adapter flexibility
- ✅ 5+ interactive capabilities (memory, tasks, and extension-registered tools)
- ✅ Token budget with auto-trimming
- ✅ Deterministic label-based matching (no LLM in pipeline)
- ✅ Works with Claude Code, OpenClaw, Pi, Cursor, Copilot

**Get started:** Create `.ai/AGENTS.md` in your project root and let the plugin handle the rest!

---

**Made with ❤️ by the dot-ai community**

*Version 5.0.0 — Last updated: 2026-03-05*
