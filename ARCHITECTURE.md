# dot-ai — Architecture Reference

> This document is designed to be given to an LLM for research purposes. It explains what dot-ai is, how it works, its goals, and its component structure — so you can research similar projects, common features, and best practices, then map your findings back to dot-ai's architecture.

## What is dot-ai?

dot-ai is a **framework-agnostic convention for AI-assisted workspaces**. It defines a standardized `.ai/` directory structure that any AI coding assistant (Claude Code, OpenClaw, Cursor, Codex, Windsurf, etc.) can use to understand a project's context, rules, memory, and capabilities.

Think of it like `.git/` for version control or `.vscode/` for editor settings — but for AI assistants.

## The Problem dot-ai Solves

Every AI coding tool has its own way of storing context:
- Claude Code uses `CLAUDE.md`
- Cursor uses `.cursor/rules/`
- OpenAI Codex uses `AGENTS.md` (at repo root)
- Windsurf uses `.windsurf/rules/`

This means:
1. **Vendor lock-in**: your AI context is tied to one tool
2. **No shared convention**: each project reinvents context management
3. **No composability**: skills, memory, and routing can't be shared across tools
4. **No structure**: context files grow into unmaintainable blobs

dot-ai solves this with a single convention (`.ai/`) plus **adapters** that translate it into each tool's native format.

## Goals

1. **Tool-agnostic**: work with any AI coding assistant, current or future
2. **Convention over configuration**: standardized file names, locations, and formats
3. **Minimal boot cost**: load only what's needed, when it's needed (token-efficient)
4. **Composable**: skills are reusable modules, providers are swappable
5. **Progressive**: start with just `AGENTS.md`, grow to full workspace as needed
6. **Multi-project**: one workspace can contain many projects with isolated contexts

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    .ai/ Convention                       │
│  (Markdown files: AGENTS.md, SOUL.md, SKILL.md, etc.)  │
│  This is the STANDARD — tool-agnostic, human-readable   │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────┐
│                     @dot-ai/core                        │
│  TypeScript interfaces + file-based implementations     │
│  Providers: Memory, Tasks, Skills, Routing, Tools       │
│  Utilities: boot(), discoverWorkspace(), validate()     │
└──────────────────────────┬──────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌─────────────┐ ┌─────────────┐  ┌─────────────┐
   │  adapter-   │ │  adapter-   │  │    cli       │
   │  openclaw   │ │  claude     │  │              │
   │             │ │             │  │ dot-ai init  │
   │ Native      │ │ Native      │  │ dot-ai scan  │
   │ plugin API  │ │ hooks API   │  │ dot-ai doctor│
   └─────────────┘ └─────────────┘  │ dot-ai audit │
                                    └─────────────┘
```

## The .ai/ Convention (the standard)

### Directory Structure

```
.ai/
├── AGENTS.md          # Operating rules, conventions, behavioral constraints
├── SOUL.md            # Persona, tone, voice, boundaries
├── USER.md            # Who the human is (name, preferences, context)
├── IDENTITY.md        # Agent name, emoji, avatar
├── TOOLS.md           # Available tools, APIs, integrations
├── MEMORY.md          # Curated long-term memory (optional)
├── memory/            # Daily session notes
│   ├── YYYY-MM-DD.md  # Daily logs
│   ├── projects-index.md  # Routing table (project → keywords)
│   └── _archive/      # Old logs
├── skills/            # Reusable AI capabilities
│   └── <name>/
│       └── SKILL.md   # Skill definition with YAML frontmatter
└── projects/          # (or at repo root level)
    └── <name>/
        └── .ai/       # Per-project context (mirrors root structure)
            ├── AGENT.md   # Project description + rules (REQUIRED)
            ├── TOOLS.md   # Project-specific tools (optional)
            ├── memory/    # Project-scoped notes
            └── skills/    # Project-specific skills
```

### File Responsibilities

| File | Purpose | Loaded |
|------|---------|--------|
| `AGENTS.md` | Global rules, conventions, how to behave | Always at boot |
| `SOUL.md` | Persona, tone, voice | Always at boot |
| `USER.md` | Human identity and preferences | Always at boot |
| `IDENTITY.md` | Agent name, emoji | Always at boot |
| `TOOLS.md` | Cross-project tool config | Always at boot |
| `MEMORY.md` | Long-term curated memory | Main session only |
| `memory/*.md` | Daily session logs | Today + yesterday |
| `skills/*/SKILL.md` | Skill definitions | On-demand (when triggered) |
| `AGENT.md` | Project description (in project `.ai/`) | On-demand (when routed) |

### Key Design Decisions

1. **Markdown-first**: all files are Markdown with optional YAML frontmatter. Human-readable, diff-friendly, no build step needed.
2. **Frontmatter for metadata**: skills and projects use YAML frontmatter (`---` delimited) for machine-parseable metadata (name, description, triggers, tags).
3. **Context isolation**: project-specific data lives in the project's `.ai/`, never in root. Identity files (SOUL, USER, IDENTITY) are inherited from root, never duplicated.
4. **On-demand loading**: only root context loads at boot. Project context loads when a prompt routes to that project. Skills load when triggered. This keeps token usage minimal.

### Skills System

A skill is a reusable AI capability defined as a Markdown file with YAML frontmatter:

```yaml
---
name: my-skill
description: What this skill does. Use when X, Y, or Z happens.
triggers: [manual, cron, boot, heartbeat, always]
---

# my-skill

Instructions for the AI on how to execute this skill...
```

Skills can be:
- **Global** (in root `.ai/skills/`) — available everywhere
- **Project-scoped** (in `projects/<name>/.ai/skills/`) — only for that project
- **Internal sub-skills** — used by other skills, not directly invocable

### Boot Sequence

Three phases, optimized for minimal token usage:

1. **Core context** (~2000 tokens): load AGENTS.md + SOUL.md + USER.md + IDENTITY.md + TOOLS.md
2. **Session context** (~300 tokens): load today + yesterday memory, projects-index.md
3. **Discovery** (~50 tokens): scan for projects and skills, build routing table

Total boot cost: ~2350 tokens. Compare to loading everything upfront: ~10,000+ tokens.

### Prompt Routing

Every prompt goes through routing:
1. Consult `projects-index.md` (lightweight table: project → keywords/tags)
2. Match prompt to project
3. Load that project's `AGENT.md` + `TOOLS.md` (on-demand)
4. Check if a skill matches
5. Execute with loaded context

This means the AI has full workspace awareness (via the index) but only loads detailed context for the relevant project.

## @dot-ai/core — The Framework

Zero-dependency TypeScript package providing:

### Provider Interfaces

Providers are swappable backends for each concern:

```typescript
interface MemoryProvider {
  readDaily(date: string): Promise<string | null>;
  writeDaily(date: string, content: string): Promise<void>;
  search(query: string): Promise<string[]>;
}

interface TaskProvider {
  list(filter?: { status?: string; project?: string }): Promise<Task[]>;
  get(id: string): Promise<Task | null>;
  create(task: Omit<Task, 'id'>): Promise<Task>;
  update(id: string, patch: Partial<Task>): Promise<Task>;
}

interface ModelRouter {
  resolveAlias(alias: string): string;        // "haiku" → "claude-haiku-4-5"
  selectForTask(taskType: string): string;     // "debugging" → opus
}

interface SkillRegistry {
  discover(rootDir: string): Promise<SkillMeta[]>;
  get(name: string): Promise<string | null>;
  validate(skillPath: string): Promise<ValidationResult>;
}
```

### Default Implementations

| Provider | Implementation | Storage |
|----------|---------------|---------|
| Memory | `FileMemoryProvider` | `.ai/memory/YYYY-MM-DD.md` |
| Tasks | `FileTaskProvider` | `.ai/memory/tasks/BACKLOG.md` (checkbox format) |
| Skills | `FileSkillRegistry` | Scan `skills/*/SKILL.md`, parse frontmatter |
| Routing | `DefaultModelRouter` | Static alias map (haiku/sonnet/opus) |

### Custom Providers (example)

A workspace can override any provider. For example, Kiwi (the reference implementation) overrides TaskProvider to use a Cockpit API instead of BACKLOG.md files:

```typescript
class CockpitTaskProvider implements TaskProvider {
  async list() { return fetch("http://localhost:3010/api/tasks").then(r => r.json()); }
  async create(task) { return fetch("http://localhost:3010/api/tasks", { method: "POST", body: JSON.stringify(task) }).then(r => r.json()); }
  // ...
}
```

### Utility Functions

| Function | Purpose |
|----------|---------|
| `boot(rootDir)` | Execute 3-phase boot, return workspace info + loaded context |
| `discoverWorkspace(rootDir)` | Scan for projects and skills |
| `validateWorkspace(rootDir)` | Check convention compliance (required files, forbidden patterns) |

## Adapters — Tool Integration

Each adapter translates the dot-ai convention into a tool's native plugin system.

### adapter-openclaw

OpenClaw is an AI gateway with a plugin SDK. The adapter:
- Registers as an OpenClaw plugin (`openclaw.plugin.json`)
- Hooks into `before_agent_start` to inject workspace context
- Uses `boot()` from core to build context
- Injects BOOTSTRAP.md (convention quick-reference) + workspace overview
- Skips injection for sub-agents and cron sessions (they don't need full boot)

### adapter-claude

Claude Code has a hooks system (`hooks.json`). The adapter:
- Provides a `plugin.json` manifest listing all skills
- Provides `hooks.json` with SessionStart (boot) and SubagentStart (model routing) hooks
- Hooks are prompt-based: they tell Claude Code to execute the boot sequence
- Detects if oh-my-claudecode (OMC) is present and defers orchestration to it

### sync.sh (for tools without plugins)

For tools like Cursor or Codex that don't have plugin systems, `sync.sh` injects references into their native config files using comment markers:
```markdown
<!-- dot-ai start -->
(managed content)
<!-- dot-ai end -->
```

## CLI — Universal Commands

| Command | What it does |
|---------|-------------|
| `dot-ai init` | Scaffold a new `.ai/` workspace with template files |
| `dot-ai scan` | Discover projects + skills, regenerate `projects-index.md` |
| `dot-ai doctor` | Validate workspace health (required files, forbidden patterns) |
| `dot-ai audit` | Full convention compliance check (structure, frontmatter, sizes, boot) |

The CLI uses only `@dot-ai/core` — it's tool-agnostic.

## What to Research

When researching similar projects and best practices, here are the components to map findings to:

### 1. Convention / Standard
- Other `.ai/` or AI workspace conventions
- How other tools structure AI context (rules, memory, persona)
- Standards for AI-readable project documentation
- Compare: `.cursorrules`, `CLAUDE.md`, `AGENTS.md`, `.windsurfrules`

### 2. Skills / Capabilities System
- Reusable AI instruction modules (like dot-ai skills)
- Prompt libraries, instruction sets, AI capability registries
- How other systems define composable AI behaviors
- Trigger-based skill activation patterns

### 3. Memory / Context Management
- AI memory systems (short-term, long-term, session-based)
- Token-efficient context loading strategies
- Memory consolidation and archival patterns
- Cross-session knowledge persistence

### 4. Provider / Plugin Architecture
- Provider pattern in AI frameworks (swappable backends)
- Plugin systems for AI tools
- Adapter pattern for multi-tool support
- How MCP (Model Context Protocol) compares

### 5. Multi-Project Routing
- AI workspace routing (dispatching prompts to the right context)
- Multi-project monorepo AI support
- Context isolation patterns
- On-demand context loading

### 6. Boot / Initialization
- AI session initialization patterns
- Context budget management
- Progressive context loading
- Workspace discovery and indexing

### 7. Audit / Validation
- Convention compliance checking
- Workspace health checks
- Automated consistency validation
- Self-healing workspace patterns

### 8. Model Routing
- Automatic model selection based on task complexity
- Model alias systems
- Cost-optimization routing (cheap model for simple tasks)
- How other frameworks handle multi-model orchestration

## Current Status

| Component | Status | Maturity |
|-----------|--------|----------|
| Convention (.ai/) | ✅ Stable | Production (used daily) |
| @dot-ai/core interfaces | ✅ Done | v0.3 |
| File-based providers | ✅ Done | v0.3 |
| adapter-openclaw | ✅ Done | Production |
| adapter-claude | ✅ Done | Production |
| CLI | ✅ Done | v0.3 (basic) |
| Custom providers | 🔧 Partial | Kiwi has CockpitTaskProvider |
| Templates | 📋 Planned | Empty, needs scaffold content |
| NPM publishing | 📋 Planned | Currently local/git install |

## Reference Implementation

The reference implementation is **Kiwi** — a personal monorepo workspace with 6 projects, 28+ skills, automated pipelines, and both OpenClaw and Claude Code integration. It uses dot-ai daily for all AI-assisted work.
