# dot-ai v5 Architecture

## Overview

dot-ai v5 = providers + engine + extensions + adapters

```
Adapter (Claude Code / Pi / OpenClaw / Sync)
  |
  v
DotAiRuntime
  +-- Providers (memory, skills, identity, routing, tasks, tools, prompts)
  +-- Engine (boot -> enrich -> format -> learn)
  +-- Extensions
  |     +-- ExtensionLoader (discover + load via jiti)
  |     +-- ExtensionRunner (fire events, collect results)
  +-- Capabilities (memory_recall, memory_store, task_*, extension tools)
```

## Core Packages

| Package | Purpose |
|---------|---------|
| `@dot-ai/core` | Types, contracts, engine, runtime, extensions, capabilities |
| `@dot-ai/adapter-claude` | Claude Code integration (hooks-based) |
| `@dot-ai/adapter-openclaw` | OpenClaw plugin |
| `@dot-ai/adapter-pi` | Pi coding agent extension |
| `@dot-ai/adapter-sync` | Sync to `.cursorrules` / `copilot-instructions.md` |
| `@dot-ai/provider-file-memory` | File-based memory provider |
| `@dot-ai/provider-sqlite-memory` | SQLite-backed memory provider |
| `@dot-ai/provider-file-skills` | File-based skill provider |
| `@dot-ai/provider-file-identity` | File-based identity provider |
| `@dot-ai/provider-file-tools` | File-based tool provider |
| `@dot-ai/provider-file-tasks` | File-based task provider |
| `@dot-ai/provider-file-prompts` | File-based prompt provider |
| `@dot-ai/provider-rules-routing` | Rules-based routing provider |
| `@dot-ai/cli` | CLI commands (install, sync, etc.) |

## Provider Contracts

Each provider implements a contract defined in `@dot-ai/core/contracts`:

| Contract | Key Methods | Purpose |
|----------|-------------|---------|
| `MemoryProvider` | `search()`, `store()`, `describe()`, `consolidate?()` | Store and recall memories |
| `SkillProvider` | `list()`, `match()`, `load()` | Discover and load skills |
| `IdentityProvider` | `load()`, `match?()` | Load identity documents (soul, agents, user) |
| `RoutingProvider` | `route()` | Decide which model to use based on labels |
| `TaskProvider` | `list()`, `get()`, `create()`, `update()` | CRUD for tasks |
| `ToolProvider` | `list()`, `match()`, `load()` | Discover and match MCP tools |
| `PromptProvider` | `list()`, `load()` | Discover and load prompt templates |

All providers are optional. Unconfigured providers are simply skipped -- the engine handles any combination gracefully.

## Configuration

`dot-ai.yml` in the `.ai/` directory:

```yaml
memory:
  use: "@dot-ai/provider-file-memory"
  with:
    root: ".ai"

skills:
  use: "@dot-ai/provider-file-skills"
  with:
    root: ".ai"

identity:
  use: "@dot-ai/provider-file-identity"
  with:
    root: ".ai"

routing:
  use: "@dot-ai/provider-rules-routing"

extensions:
  paths:
    - ./custom-extensions
  packages:
    - my-dot-ai-extension
```

## DotAiRuntime

`DotAiRuntime` is the main entry point for adapters. It encapsulates the full pipeline lifecycle.

```typescript
const runtime = new DotAiRuntime({
  workspaceRoot: '/path/to/project',
  logger: new JsonFileLogger('/path/to/log'),
});

// Boot once per session
await runtime.boot();

// Process each prompt
const { formatted, enriched, capabilities } = await runtime.processPrompt(userPrompt);

// After agent responds
await runtime.learn(agentResponse);

// End of session
await runtime.shutdown();
```

### RuntimeOptions

| Option | Type | Description |
|--------|------|-------------|
| `workspaceRoot` | string | Root directory containing `.ai/` |
| `logger` | Logger | Optional structured logger |
| `skipIdentities` | boolean | Skip identity sections in output |
| `maxSkills` | number | Maximum skills in formatted output |
| `maxSkillLength` | number | Max characters per skill |
| `tokenBudget` | number | Token budget for formatted output |
| `providerFactories` | Record | Explicit provider factory overrides |
| `providers` | Providers | Pre-built providers (bypasses config) |
| `extensions` | ExtensionsConfig | Extension configuration |

## Pipeline Flow

### Boot Phase (once per session)

```
runtime.boot()
  +-- loadConfig(workspaceRoot)
  +-- loadHooks(config.hooks)
  +-- createProviders(config)         // or use pre-built providers
  +-- boot(providers)
  |     +-- Load identities (parallel)
  |     +-- List skills (parallel)
  |     +-- List tools (parallel)
  |     +-- Build label vocabulary
  |     +-- Run after_boot hooks
  +-- discoverExtensions(workspaceRoot, config.extensions)
  +-- loadExtensions(paths, providers, eventBus)
  +-- buildCapabilities(providers, extensionTools)
  +-- Fire session_start event
```

### Prompt Phase (per prompt)

```
runtime.processPrompt(prompt)
  +-- enrich(prompt, providers, cache)
  |     +-- extractLabels(prompt, vocabulary)
  |     +-- Search memory (parallel)
  |     +-- Match skills (parallel)
  |     +-- Match tools (parallel)
  |     +-- Route model (parallel)
  |     +-- List recent tasks (parallel)
  |     +-- Match project identities
  |     +-- Run after_enrich hooks
  +-- Load skill content (lazy)
  +-- formatContext(enriched)
  +-- applyFormatHooks(formatted)
  +-- Fire context_inject -> append injected text
  +-- Return { formatted, enriched, capabilities }
```

### Tool Call Phase (adapter-driven)

```
runtime.fireToolCall({ tool, input })
  +-- ExtensionRunner.fireUntilBlocked('tool_call', event)
        +-- Iterate extensions in load order
        +-- First handler returning { decision: 'block' } stops iteration
        +-- Return blocking result, or null if all allow
```

### Learn Phase (after agent response)

```
runtime.learn(response)
  +-- Store in memory (if provider configured, response is substantial)
  +-- Run after_learn hooks
  +-- Fire agent_end event
```

### Shutdown Phase

```
runtime.shutdown()
  +-- Fire session_end event
  +-- Flush logger buffers
```

## Extension System

### Two-Tier Event System

**Tier 1 (Universal):** Events that all adapters can support -- text injection, tool gating, lifecycle hooks. These are: `context_inject`, `tool_call`, `agent_end`, `session_start`, `session_end`.

**Tier 2 (Rich):** Events that require deep agent integration -- message modification, per-tool result access, turn boundaries. These are: `context_modify`, `tool_result`, `turn_start`, `turn_end`. Currently only supported by the Pi adapter.

Adapters silently skip tier 2 events they don't support. Extensions receive warnings in logs but continue to function.

### Loading Flow

1. `discoverExtensions()` scans `.ai/extensions/` directories, config paths, and npm packages
2. `loadExtensions()` imports each file via jiti (or native import fallback), calls the default export with a collector API
3. The factory registers event handlers and tools on the collector API
4. The collector builds a `LoadedExtension` with handler maps, tool maps, and tier metadata
5. `ExtensionRunner` wraps all loaded extensions for event dispatch
6. The runtime fires events through the runner during each pipeline phase

### Event Dispatch

- `fire<T>(event, data)` -- broadcasts to all handlers across all extensions, collects results, catches errors per handler
- `fireUntilBlocked(event, data)` -- stops at the first handler returning `{ decision: 'block' }` (used for `tool_call`)

### Extension Tools as Capabilities

Extension tools registered via `api.registerTool()` are converted to `Capability` objects via `toolDefinitionToCapability()` and merged with the built-in provider capabilities (memory_recall, memory_store, task_list, task_create, task_update). Adapters register all capabilities as native tools in the agent.

## Provider -> Extension -> Adapter Data Flow

```
Providers (data sources)
  |
  +---> Engine enriches context (enrich phase)
  |       |
  |       +---> Extensions inject/modify
  |       |     (context_inject appends text to formatted output)
  |       |     (context_modify can alter messages -- tier 2 only)
  |       |
  |       +---> Formatted output string
  |
  +---> Extensions access providers directly
  |     (api.providers.memory.search(), api.providers.tasks.list(), etc.)
  |
  +---> Capabilities (tools exposed to agent)
  |     (built-in from providers + extension-registered tools)
  |
  +---> Adapter translates to agent-native format
        (system prompt injection, tool registration, hook wiring)
```

## Labels

Labels are boolean tags extracted from the prompt against a known vocabulary. They drive skill matching, tool matching, routing decisions, and project identity loading. Labels have a `name` and a `source` (which step produced them).

The vocabulary is built at boot from skill labels, skill triggers, tool labels, and project node names.

## Hooks

Hooks are lifecycle interceptors configured in `dot-ai.yml` under the `hooks` section. They run at four points: `after_boot`, `after_enrich`, `after_format`, `after_learn`. Unlike extensions, hooks are loaded from npm packages and configured per-project rather than discovered from directories.

## Nodes

Nodes represent directories containing `.ai/` context. The root node is always included. Sub-nodes are discovered via `scanDirs` configuration and enable per-project identities and skills in monorepo setups.

## Diagnostics

`runtime.diagnostics` returns:

```typescript
{
  extensions: ExtensionDiagnostic[],  // per-extension handler counts, tool names, tiers
  usedTiers: string[],               // which tiers are in use
  providerStatus: Record<string, boolean>,  // which providers are configured
  capabilityCount: number,           // total capabilities registered
}
```
