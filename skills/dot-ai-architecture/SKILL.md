---
name: dot-ai-architecture
description: "Complete architecture reference for the dot-ai context enrichment engine. Covers contracts, providers, adapters, capabilities, hooks, token budget, and integration patterns."
labels: [architecture, dot-ai, providers, adapters, capabilities, hooks, engine, runtime]
triggers: [manual]
enabled: true
---

# dot-ai Architecture Reference

## Purpose

dot-ai is a **deterministic context enrichment engine** for AI workspaces. It is not an agent. It is a library with a pipeline that transforms a raw prompt into enriched markdown context by matching it against workspace knowledge: skills, memory, identities, tools, and routing rules.

The key insight: **the agent is the consumer, dot-ai is the provider.** Agents never call dot-ai directly. Adapters hook into the agent's native event system (Claude Code hooks, OpenClaw plugins) and transparently inject enriched context before the agent sees the prompt.

## Architecture Overview

```
+-------------------------------------------------------------+
|  Agent Environment (Claude Code / OpenClaw / Custom)         |
|  +--------------------------------------------------------+  |
|  |  Adapter                                                |  |
|  |  Hooks into native agent events.                        |  |
|  |  Calls DotAiRuntime.processPrompt() per prompt.         |  |
|  +----------------------------+---------------------------+  |
|                               v                              |
|  +----------------------------+---------------------------+  |
|  |  DotAiRuntime (@dot-ai/core)                           |  |
|  |  1. loadConfig    2. resolve providers                  |  |
|  |  3. createProviders  4. boot (cache)                    |  |
|  |  5. processPrompt (enrich+format+hooks)                 |  |
|  |  6. learn          7. flush                             |  |
|  +---+--------+--------+--------+--------+--------+------+  |
|      v        v        v        v        v        v          |
|   Memory   Skills   Identity  Routing   Tasks    Tools       |
|   Provider Provider Provider  Provider Provider  Provider    |
|                                                              |
|  Cross-cutting: Capabilities (tools) + Hooks (pipeline)      |
+-------------------------------------------------------------+
```

## The Pipeline

### DotAiRuntime (Recommended Entry Point)

Encapsulates the full lifecycle. Adapters instantiate it once and call `processPrompt()` per prompt.

```typescript
import { DotAiRuntime } from '@dot-ai/core';
const runtime = new DotAiRuntime({
  workspaceRoot: '/path/to/workspace',
  logger: myLogger,         // optional, defaults to NoopLogger
  skipIdentities: false,    // skip identity sections in output
  maxSkills: 10,            // max skills in formatted output
  maxSkillLength: 4000,     // max chars per skill content
  tokenBudget: 8000,        // auto-trim to fit this budget
});
await runtime.boot();       // idempotent, call once per session
const { formatted, enriched, capabilities } = await runtime.processPrompt(prompt);
await runtime.learn(response);  // store in memory after response
await runtime.flush();          // flush logger before exit
```

### boot(providers) -> BootCache

Called **once per session**. Loads identities, lists skills and tools (metadata only), builds vocabulary from all labels. Returns `BootCache { identities, vocabulary, skills }`. Vocabulary and identities do not change mid-session.

### enrich(prompt, providers, cache) -> EnrichedContext

Called **per prompt**:
1. **Extract labels** -- word-boundary regex match against vocabulary. No LLM. Deterministic.
2. **Query all providers in parallel** (`Promise.all`): memory.search, skills.match, tools.match, routing.route, tasks.list
3. **Return EnrichedContext**: `{ prompt, labels, identities, memories, memoryDescription?, recentTasks?, skills, tools, routing }`

After enrich, adapters load skill content for matched skills via `skills.load(name)`.

### learn(response, providers)

Called **after agent response**. Stores truncated version (max 500 chars) in memory as type `'log'`. Skips responses under 50 chars.

### formatContext(enriched, options) -> string

Converts EnrichedContext to markdown. Section order: identity > memory > tasks > skills > tools > routing.

**Token budget trimming** (applied in order until under budget):
1. Truncate skill content to 2000 chars each
2. Drop oldest memories (keep most recent 5)
3. Drop least-relevant skills one by one

Identity content is **never trimmed**.

## The 6 Contracts

All TypeScript interfaces in `@dot-ai/core`. Providers are interchangeable.

### MemoryProvider
`search(query, labels?) -> MemoryEntry[]` | `store(entry) -> void` | `describe() -> string`
Searches and persists memory entries. `describe()` returns a human-readable provider description for context injection.

### SkillProvider
`list() -> Skill[]` | `match(labels) -> Skill[]` | `load(name) -> string | null`
Lists skills (metadata at boot), matches to labels, lazy-loads content on demand.

### IdentityProvider
`load() -> Identity[]`
Loads identity documents (AGENTS.md, SOUL.md, USER.md, IDENTITY.md). Each has type, content, priority, and optional node.

### RoutingProvider
`route(labels, context?) -> RoutingResult`
Returns `{ model, reason, fallback? }`. Rules-based default matches labels to model tiers.

### TaskProvider
`list(filter?) -> Task[]` | `get(id) -> Task | null` | `create(task) -> Task` | `update(id, patch) -> Task`
CRUD for tasks. Filter by status, project, or tags.

### ToolProvider
`list() -> Tool[]` | `match(labels) -> Tool[]` | `load(name) -> Tool | null`
Discovers and matches external tools (MCP servers, integrations).

## Capabilities

Interactive tools that agents can call at runtime. `buildCapabilities(providers)` generates them from active providers.

| Capability | Category | ReadOnly | Purpose |
|------------|----------|----------|---------|
| `memory_recall` | memory | yes | Search stored memories |
| `memory_store` | memory | no | Store a new memory entry |
| `task_list` | tasks | yes | List tasks with filters |
| `task_create` | tasks | no | Create a task |
| `task_update` | tasks | no | Update a task |

Each has a JSON Schema for parameters and an `execute()` function. Adapters translate to native tool format (MCP tools for Claude, registerTool for OpenClaw).

**Extensibility:** any provider with a `capabilities()` method contributes additional capabilities automatically.

## Hooks

4 pipeline extension points, configured in `dot-ai.yml`, executed sequentially.

| Event | Transforming? | Signature |
|-------|---------------|-----------|
| `after_boot` | No | `(cache: BootCache) -> void` |
| `after_enrich` | Yes | `(ctx) -> EnrichedContext | void` |
| `after_format` | Yes | `(formatted, ctx) -> string | void` |
| `after_learn` | No | `(response) -> void` |

Hook packages are dynamically imported. Factory function (`default` or `createHook`) is called with `with` options. Errors are caught per-hook and logged -- never block the pipeline.

```yaml
hooks:
  after_enrich:
    - use: '@my/custom-hook'
      with: { threshold: 0.8 }
```

## Labels and Vocabulary

Labels bridge prompts to capabilities. Word-boundary regex (`\bword\b`, case-insensitive) tested against the vocabulary.

Vocabulary is built at boot from skill labels, non-meta skill triggers, and tool labels. Meta-triggers excluded: `always`, `auto`, `manual`, `boot`, `heartbeat`, `pipeline`, `audit`.

**Why deterministic?** Reproducible (same prompt = same labels), zero LLM cost, no hallucination, predictable routing.

## Workspace Nodes

Multi-project support. `discoverNodes(root, scanDirs)` finds `.ai/` directories.

```typescript
interface Node { name: string; path: string; root: boolean; }
```

Root node always included. Sub-nodes discovered in configured scan directories (default: `projects`). Nodes injected into all providers via `injectRoot()` so file-based providers scan all `.ai/` dirs.

## Configuration (dot-ai.yml)

Located at `.ai/dot-ai.yml`. Each domain declares `use` (package name) and optional `with` (options).

```yaml
memory:
  use: '@dot-ai/provider-sqlite-memory'
  with: { dbPath: '.ai/memory.db' }
skills:
  use: '@dot-ai/provider-file-skills'
workspace:
  scanDirs: 'projects'
debug:
  logPath: '.ai/trace.jsonl'
```

- `${VAR_NAME}` resolved from environment at load time
- Missing sections default to file-based providers
- Minimal hand-written YAML parser (no dependency)

## Creating a Custom Provider

1. Implement the contract interface
2. Export as `create{Role}Provider` function, `{Role}Provider` class, or default export
3. Declare in `dot-ai.yml` with `use: '@my/package'`

The loader dynamically imports the package and instantiates with `with` options. For pre-registration: `registerProvider('@my/pkg:memory', factory)`.

## Creating a Custom Adapter

1. Instantiate `DotAiRuntime` with workspace root
2. Hook into agent's native prompt/response events
3. Call `processPrompt()` per prompt, inject `formatted` into context
4. Register `capabilities` as native tools
5. Call `learn()` after significant responses
6. Call `flush()` before exit

## Existing Adapters

**adapter-claude** (`packages/adapter-claude/`): Claude Code hooks (UserPromptSubmit, pre-compact, stop, pre-tool-use). MCP server for capabilities. Silent failure. Blocks `memory/*.md` writes.

**adapter-openclaw** (`packages/adapter-openclaw/`): `before_agent_start` hook. `skipIdentities: true` (OpenClaw injects separately). Session-level cache. Skips sub-agents and crons.

**adapter-sync** (`packages/adapter-sync/`): File sync with markers for Cursor/Copilot.

## Packages

| Package | Purpose |
|---------|---------|
| `@dot-ai/core` | Contracts, engine, config, format, labels, loader, logger, runtime |
| `@dot-ai/provider-file-memory` | File-based memory (.ai/memory/*.md) |
| `@dot-ai/provider-file-skills` | File-based skills (.ai/skills/*/SKILL.md) |
| `@dot-ai/provider-file-identity` | File-based identity (AGENTS/SOUL/USER/IDENTITY.md) |
| `@dot-ai/provider-file-tasks` | File-based tasks (JSON) |
| `@dot-ai/provider-file-tools` | File-based tools (.ai/TOOLS.md) |
| `@dot-ai/provider-rules-routing` | Rules-based model routing |
| `@dot-ai/provider-sqlite-memory` | SQLite + FTS5 memory |
| `@dot-ai/adapter-claude` | Claude Code integration |
| `@dot-ai/adapter-openclaw` | OpenClaw integration |
| `@dot-ai/adapter-sync` | File sync for Cursor/Copilot |
| `@dot-ai/cli` | CLI: init, boot, trace |

## Key Principles

1. **Deterministic**: same prompt = same labels = same context. No LLM in the pipeline.
2. **Contract-based**: providers are interchangeable. Swap without touching core.
3. **Best-effort**: partial context > no context. Failed providers are skipped.
4. **Cached**: boot once, enrich many.
5. **Parallel**: all providers queried concurrently.
6. **Extensible**: hooks, custom capabilities, custom adapters.
7. **Lazy**: skill content loaded on demand, not at boot.
8. **Invisible**: agents never know dot-ai exists.
