# dot-ai — Universal AI Workspace Convention

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-latest-green.svg)](package.json)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-compatible-purple.svg)](https://github.com/openclaw/openclaw)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-blue.svg)](https://claude.ai/claude-code)
[![Pi](https://img.shields.io/badge/Pi-compatible-orange.svg)](https://github.com/jogelin/dot-ai)

> **A standardized `.ai/` workspace structure for AI assistants — with an extension-only architecture for Claude Code, OpenClaw, Pi, Cursor, and Copilot.**

The dot-ai convention provides a universal workspace structure that helps AI assistants understand your project context, manage tasks, route between projects, and maintain consistency across sessions. v7 replaces the provider system with a unified **extension-only architecture** where everything — identity, memory, skills, routing, tools — is an extension.

---

## ✨ Features

- 🏗️ **Workspace Structure** — Standardized `.ai/` directory with boot sequence and project routing
- 🧩 **Extension-Only Architecture** — Everything is an extension: identity, memory, skills, routing, tools
- 🎯 **Section-Based Context** — Extensions return `Section` objects assembled by priority with token-budget trimming
- 📊 **Token Budget** — `formatSections()` auto-trims sections to fit context window with BudgetWarning diagnostics
- 🔧 **Extension-Registered Tools** — Tools defined in extensions, exposed as native agent capabilities
- 🔍 **Deterministic Labels** — Regex-based label extraction from vocabulary (no LLM in pipeline)
- 🚀 **DotAiRuntime** — Single class encapsulating boot, processPrompt, fireToolCall, fire, shutdown
- 🔄 **5 Emission Patterns** — fire, fireCollectSections, fireFirstResult, fireChainTransform, fireUntilBlocked
- 📡 **Boot Caching** — Extensions discovered once per session, vocabulary built at boot

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
| `@dot-ai/core` | Runtime engine, extension runner, section formatting |
| `@dot-ai/adapter-claude` | Claude Code adapter |
| `@dot-ai/adapter-pi` | Pi adapter (full event support) |
| `@dot-ai/adapter-sync` | Cursor / Copilot / Windsurf sync adapter |
| `@dot-ai/adapter-openclaw` | OpenClaw adapter |
| `@dot-ai/ext-sqlite-memory` | SQLite-backed memory extension |
| `@dot-ai/ext-file-memory` | File-backed memory extension |
| `@dot-ai/ext-file-skills` | File-based skills extension |
| `@dot-ai/ext-file-identity` | File-based identity extension |
| `@dot-ai/ext-file-tools` | File-based tools extension |
| `@dot-ai/ext-file-tasks` | File-based tasks extension |
| `@dot-ai/ext-file-prompts` | File-based prompts extension |
| `@dot-ai/ext-rules-routing` | Rules-based routing extension |
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
- ✅ Discovers and activates extensions from `.ai/extensions/` and installed packages
- ✅ Enforces task management conventions
- ✅ Optimizes model selection for sub-agents
- ✅ Provides access to all skills and capabilities

**No local installation needed** — the plugin provides skills globally!

---

## 🧩 Extension System

Extensions are the **only** mechanism for contributing content in v7. Place TypeScript files in `.ai/extensions/` or install extension packages — they are loaded automatically at boot.

### Writing an Extension

```typescript
// .ai/extensions/security-gate.ts
import type { ExtensionAPI } from '@dot-ai/core';

export default function(api: ExtensionAPI) {
  // Gate tool calls
  api.on('tool_call', async (event) => {
    if (event.tool === 'Write' && event.input.file_path?.toString().endsWith('.env')) {
      return { decision: 'block', reason: 'Cannot write to .env files' };
    }
  });

  // Enrich context with sections
  api.on('context_enrich', async (event) => {
    return {
      sections: [{
        title: 'Security Rules',
        content: '> Always write tests for new features.',
        priority: 70,
        source: 'security-gate',
      }],
    };
  });

  // Register skills, identities, labels
  api.registerSkill({ name: 'security', description: 'Security rules', labels: ['security'] });
  api.contributeLabels(['security', 'auth', 'secrets']);
}
```

### Extension Events

| Event | Emission Pattern | Description |
|-------|-----------------|-------------|
| `context_enrich` | fireCollectSections | Extensions return `{ sections }` for context injection |
| `label_extract` | fireChainTransform | Extensions modify the labels array |
| `route` | fireFirstResult | First extension to return a routing result wins |
| `tool_call` | fireUntilBlocked | Gate or block tool calls before execution |
| `tool_result` | fireChainTransform | Observe or transform tool results |
| `agent_end` | fire | React when an agent completes |
| `input` | fireChainTransform | Rewrite user input before processing |
| `session_start` | fire | Session lifecycle |
| `session_end` | fire | Session lifecycle |
| `session_compact` | fire | Context compaction event |

### Extension API

Extensions receive an `ExtensionAPI` object with:

| Method | Purpose |
|--------|---------|
| `api.on(event, handler)` | Subscribe to events |
| `api.registerTool(tool)` | Register a tool the agent can invoke |
| `api.registerCommand(cmd)` | Register a slash command |
| `api.registerSkill(skill)` | Register a skill for context enrichment |
| `api.registerIdentity(identity)` | Register an identity document |
| `api.contributeLabels(labels)` | Add labels to the global vocabulary |
| `api.events` | Inter-extension event bus |
| `api.config` | Extension-specific configuration |
| `api.workspaceRoot` | Workspace root directory |

### Adapter Capability Matrix

Not all adapters support every event. The matrix below shows what each adapter can fire:

| Adapter | context_enrich | tool_call | agent_end | tool_result | input |
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
│   ├── extensions/             # User-authored extensions (v7)
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
- **Extensions** — `.ai/extensions/` and installed packages loaded at boot
- **Data Separation** — `.ai/data/` = structured only, no research/drafts
- **Memory Organization** — Daily notes, tasks, research separated

---

## 🎯 Usage Examples

### Task Management

**Always use `dot-ai-tasks` instead of built-in todos.**

Tasks are managed through the task extension. The extension can be backed by:
- **File-based** (`@dot-ai/ext-file-tasks`) — JSON files in `.ai/memory/tasks/`
- **Custom** — Any extension implementing the task pattern

Configure in `.ai/settings.json`:

```json
{
  "packages": [
    "@dot-ai/ext-file-tasks"
  ]
}
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

### Engine Architecture (v7)

```
Agent (Claude Code / OpenClaw / Pi / Cursor / Copilot)
  └── Adapter (hooks into native events)
        └── DotAiRuntime (@dot-ai/core)
              ├── boot()           → discover extensions, register resources, build vocabulary
              ├── processPrompt()  → label_extract, context_enrich, route → { sections, labels, routing }
              ├── fireToolCall()   → extension-based tool gating
              ├── fire('agent_end', { response })  → notify extensions
              ├── shutdown()       → session_end + flush
              └── diagnostics      → extension status

  Extensions (everything is an extension):
  ├── ext-file-identity     → registerIdentity(), context_enrich
  ├── ext-file-memory       → context_enrich, agent_end
  ├── ext-file-skills       → registerSkill(), context_enrich
  ├── ext-rules-routing     → route event handler
  ├── ext-file-tasks        → registerTool(), context_enrich
  ├── ext-file-tools        → registerTool(), context_enrich
  ├── ext-file-prompts      → context_enrich
  ├── ext-sqlite-memory     → context_enrich, agent_end
  └── .ai/extensions/*.ts   → user-authored extensions
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

### settings.json

The central configuration file at `.ai/settings.json`:

```json
{
  "packages": [
    "@dot-ai/ext-file-identity",
    "@dot-ai/ext-file-memory",
    "@dot-ai/ext-file-skills",
    "@dot-ai/ext-rules-routing",
    "@dot-ai/ext-file-tasks",
    "@dot-ai/ext-file-tools"
  ],
  "extensions": [
    ".ai/extensions/custom.ts"
  ],
  "debug": {
    "logPath": ".ai/debug.log"
  }
}
```

### Global Configuration

User-level defaults can be set in `~/.ai/settings.json`. These are merged with project-level settings (arrays deduplicated, project scalars win):

```json
{
  "packages": [
    "@dot-ai/ext-file-identity",
    "@dot-ai/ext-file-memory"
  ]
}
```

### Auto-Install

Packages listed in `settings.json` are **automatically installed** into `.ai/packages/` at boot if not already present. No manual `npm install` needed.

### Workspace Resolution

Each adapter resolves the workspace root (the directory containing `.ai/`) and passes it to `DotAiRuntime`. The resolution priority varies by adapter:

**OpenClaw adapter:**

| Priority | Source | Use Case |
|----------|--------|----------|
| 1 | `process.cwd()` | CLI / local usage where cwd is the project |
| 2 | `pluginConfig.workspace` | Gateway / Discord / TUI where cwd is not the project |
| 3 | `ctx.workspaceDir` | OpenClaw fallback |

**Claude Code adapter:** Uses the hook's `cwd` (always the project directory).

**Pi adapter:** Uses the configured `workspaceRoot` option.

### OpenClaw Configuration

In `openclaw.json`, configure the workspace path for gateway/Discord/TUI environments under `plugins.entries.dot-ai.config`:

```json
{
  "plugins": {
    "entries": {
      "dot-ai": {
        "enabled": true,
        "config": {
          "workspace": "/Users/you/dev/my-project",
          "modelRouting": {
            "enabled": true,
            "defaultSubagentModel": "anthropic/claude-haiku",
            "maxConcurrentSubagents": 8
          }
        }
      }
    }
  }
}
```

### Claude Code Configuration

Uses `.claude-plugin/plugin.json` for metadata and skill registration.

---

## 📖 Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Full v7 architecture (runtime, extensions, events, formatting)
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

1. Create a `.ts` file in `.ai/extensions/` or a new `ext-*` package
2. Export a default function that receives `ExtensionAPI`
3. Register resources (`registerSkill`, `registerIdentity`, `contributeLabels`)
4. Subscribe to events (`context_enrich`, `tool_call`, `agent_end`, etc.)
5. Extensions are loaded automatically at boot — no registration needed

### Release Process

Releases are **CI-only** — never run the release script locally.

- **Trigger:** Manual `workflow_dispatch` on GitHub Actions (`.github/workflows/release.yml`)
- **Versioning:** All packages use **fixed versioning** (same version). Current version is resolved from **git tags**, not `package.json`.
- **Bump detection:** Automatic via [conventional commits](https://www.conventionalcommits.org/) (`feat:` → minor, `fix:` → patch)
- **What happens:**
  1. Bumps all `packages/*/package.json`
  2. Syncs plugin manifests (`openclaw.plugin.json`, `.claude-plugin/plugin.json`, etc.)
  3. Generates `CHANGELOG.md`, creates git commit & tag
  4. Publishes all packages to npm

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
- ✅ Extension-only architecture — everything (identity, memory, skills, routing, tools) is an extension
- ✅ Section-based context enrichment via `context_enrich` event
- ✅ DotAiRuntime with boot, processPrompt, fireToolCall, fire, shutdown
- ✅ 5 emission patterns (fire, fireCollectSections, fireFirstResult, fireChainTransform, fireUntilBlocked)
- ✅ Token budget with section-aware trimming (`formatSections`, `trimSections`)
- ✅ Deterministic label-based matching (no LLM in pipeline)
- ✅ Boot caching for fast per-prompt enrichment
- ✅ Works with Claude Code, OpenClaw, Pi, Cursor, Copilot

**Get started:** Create `.ai/AGENTS.md` in your project root and let the plugin handle the rest!

---

**Made with ❤️ by the dot-ai community**

*Last updated: 2026-03-07*
