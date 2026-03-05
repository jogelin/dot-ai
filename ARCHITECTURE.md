# dot-ai v4.2 Architecture

## What is dot-ai?

dot-ai is a **deterministic context enrichment convention** for AI workspaces. It's not an agent, not a runtime—it's a standardized set of contracts and a pipeline that transforms a raw prompt into enriched context by matching it against workspace knowledge (skills, memory, identities, tools, routing rules).

Key insight: **The agent is the consumer, dot-ai is the provider.** Adapters integrate dot-ai into specific agents (Claude Code, OpenClaw) via native hooks, making enrichment invisible to the agent while giving it complete workspace context.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Agent Environment (Claude Code / OpenClaw)                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Adapter (adapter-claude / adapter-openclaw)       │    │
│  │  Hooks into native agent events:                   │    │
│  │  - Claude Code: UserPromptSubmit + pre-compact    │    │
│  │    + stop + pre-tool-use hooks, MCP server        │    │
│  │  - OpenClaw: before_agent_start hook              │    │
│  └────────────────────────────────────────────────────┘    │
│                       │                                      │
│                       ▼                                      │
│  ┌────────────────────────────────────────────────────┐    │
│  │  DotAiRuntime (core package)                      │    │
│  │  Encapsulates full pipeline lifecycle:            │    │
│  │                                                    │    │
│  │  1. loadConfig(.ai/dot-ai.yml)                    │    │
│  │  2. resolve providers via dynamic import()         │    │
│  │  3. createProviders(config)                       │    │
│  │  4. boot() → cache identities + vocabulary        │    │
│  │  5. processPrompt() → enrich + format + hooks     │    │
│  │  6. learn() → store in memory                     │    │
│  │  7. flush() → flush logger before exit            │    │
│  └────────────────────────────────────────────────────┘    │
│                       │                                      │
│           ┌───────────┼───────────────┬──────────┐          │
│           ▼           ▼               ▼          ▼          │
│      Memory      Skills          Identity    Routing        │
│      Provider    Provider         Provider    Provider       │
│      (files,     (files,          (files,     (rules,       │
│       sqlite,     .ai/skills/)      .ai/)      LLM)         │
│       etc)                                                   │
│           │           │               │          │          │
│           └───────────┼───────────────┴──────────┘          │
│                       ▼                                      │
│        ┌──────────────┴──────────────┐                      │
│        ▼                             ▼                      │
│   Capabilities (tools)         Hooks (pipeline events)      │
│   memory_recall, task_create   after_boot, after_enrich     │
│   → mapped to native format    after_format, after_learn    │
│        │                             │                      │
│        ▼                             ▼                      │
│   .ai/ directory structure                                  │
│   (file-based providers' domain)                            │
└─────────────────────────────────────────────────────────────┘
```

---

## The 6 Core Contracts

These TypeScript interfaces define what a provider must implement. Implementation is left entirely to the provider.

| Contract | Methods | Purpose |
|----------|---------|---------|
| **MemoryProvider** | `search(query, labels?)`, `store(entry)` | Search and persist memory entries (facts, decisions, logs, patterns) |
| **SkillProvider** | `list()`, `match(labels)`, `load(name)` | Discover skills, match to prompt labels, load skill content |
| **IdentityProvider** | `load()` | Load identity documents (AGENTS.md, SOUL.md, USER.md, IDENTITY.md) with priority ordering |
| **RoutingProvider** | `route(labels, context?)` | Decide which model to use (haiku/sonnet/opus) based on prompt characteristics |
| **TaskProvider** | `list(filter)`, `get(id)`, `create(task)`, `update(id, patch)` | CRUD operations for tasks (e.g., Cockpit API, file-based, Jira) |
| **ToolProvider** | `list()`, `match(labels)`, `load(name)` | Discover and match tools (MCP servers, external integrations) |

All providers are **interchangeable**: file-based defaults, or custom implementations (SQLite, REST APIs, etc.).

---

## Engine Flow: boot() → enrich() → learn()

### 1. Boot Phase (once per session)

```typescript
async function boot(
  providers: Providers,
  logger?: Logger,
  hooks?: Hook[],
): Promise<BootCache>
```

Runs **once** at session start. Caches static data across multiple prompts:

- **Load identities** from IdentityProvider (AGENTS.md, SOUL.md, etc.)
- **List all skills** from SkillProvider
- **List all tools** from ToolProvider
- **Build vocabulary** — index all skill + tool labels into a searchable dictionary

Returns **BootCache**: `{ identities, vocabulary, skills }`

Why caching? Identity docs don't change mid-session. Building vocabulary once is much cheaper than rebuilding for every prompt.

### 2. Enrich Phase (per prompt)

```typescript
async function enrich(
  prompt: string,
  providers: Providers,
  cache: BootCache,
  logger?: Logger,
  hooks?: Hook[],
): Promise<EnrichedContext>
```

Runs **for each prompt**. Transforms a raw prompt into enriched context:

1. **Extract labels** — Simple regex match prompt against vocabulary (no LLM)
   - Deterministic: same prompt = same labels every time
   - Examples: `["code-fix", "implementation"]`

2. **Query all providers in parallel**:
   - `memory.search(prompt, labels)` — Find relevant memories
   - `skills.match(labels)` — Find matching skills
   - `tools.match(labels)` — Find matching tools
   - `routing.route(labels)` — Decide which model

3. **Return EnrichedContext**:
   ```typescript
   {
     prompt: string;
     labels: Label[];           // What we detected
     identities: Identity[];    // From boot cache
     memories: MemoryEntry[];   // From memory search
     skills: Skill[];           // Matched + lazy-loaded
     tools: Tool[];             // Matched
     routing: RoutingResult;    // Model suggestion
   }
   ```

### 3. Learn Phase (after agent response)

```typescript
async function learn(
  response: string,
  providers: Providers,
  logger?: Logger,
  hooks?: Hook[],
): Promise<void>
```

Called after agent produces a response. Stores learnings in memory:

- **Min-length guard:** Responses shorter than 50 characters are skipped (avoids storing noise)
- Entry type: `'log'` (could also be `'fact'`, `'decision'`, `'pattern'`)
- Date: auto-set to today
- Source: `'learn'`

Adapters decide when to call this (typically not on every response, but on significant outcomes).

---

## DotAiRuntime

`DotAiRuntime` is a class in `packages/core/src/runtime.ts` that encapsulates the full pipeline lifecycle. Adapters should use this instead of wiring `loadConfig → createProviders → boot → enrich → format` manually.

```typescript
import { DotAiRuntime } from '@dot-ai/core';

const runtime = new DotAiRuntime({
  workspaceRoot: '/path/to/workspace',
  logger,
  skipIdentities: true,    // if adapter injects identities separately
  maxSkillLength: 3000,
  maxSkills: 5,
  tokenBudget: 8000,
});

await runtime.boot();                              // once per session
const { formatted, enriched, capabilities } = await runtime.processPrompt(prompt);
await runtime.learn(response);                     // after significant responses
await runtime.flush();                             // before process exit (CLI hooks)
```

Key properties: `.capabilities`, `.providers`, `.isBooted`

Both `adapter-claude` and `adapter-openclaw` use `DotAiRuntime` internally. New adapters should too — it eliminates the boilerplate of manually orchestrating the pipeline.

---

## Capabilities

Capabilities are interactive tools defined once in core, mapped by adapters to native agent format.

```typescript
interface Capability {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  execute(params: Record<string, unknown>): Promise<CapabilityResult>;
  category?: 'memory' | 'tasks' | string;
  readOnly?: boolean;
  confirmationRequired?: boolean;
  version?: number;
}
```

### Built-in Capabilities

Providers expose capabilities automatically:

| Provider | Capability | Method |
|----------|-----------|--------|
| MemoryProvider | `memory_recall` | `search(query, limit)` |
| MemoryProvider | `memory_store` | `store({ content, type })` |
| TaskProvider | `task_list` | `list({ status?, project?, tags? })` |
| TaskProvider | `task_create` | `create({ text, project?, priority?, tags? })` |
| TaskProvider | `task_update` | `update(id, { status?, text?, priority? })` |

### Adapter Mapping

Adapters map capabilities to native format:
- **OpenClaw**: `api.registerTool()` for each capability
- **Claude Code**: MCP server exposes capabilities as MCP tools

### Provider Extensibility

Providers can implement an optional `capabilities()` method to add custom tools beyond the built-in ones. This lets third-party providers surface domain-specific operations (e.g., a Jira provider could expose `jira_create_issue`).

---

## Hooks

4 pipeline events for extension:

| Event | When | Transform? | Signature |
|-------|------|-----------|-----------|
| `after_boot` | After boot() | No | `(cache: BootCache) => Promise<void>` |
| `after_enrich` | After enrich() | Yes → EnrichedContext | `(ctx: EnrichedContext) => Promise<EnrichedContext \| void>` |
| `after_format` | After formatContext() | Yes → string | `(formatted: string, ctx: EnrichedContext) => Promise<string \| void>` |
| `after_learn` | After learn() | No | `(response: string) => Promise<void>` |

### Configuration

Hooks are declared in `dot-ai.yml`:

```yaml
hooks:
  after_enrich:
    - use: "@my-org/hook-custom-enrichment"
      with: { option: value }
```

### Execution Model

- Hooks are loaded like providers (dynamic import, factory pattern)
- Sequential execution in declaration order
- Errors caught and logged, never block pipeline
- If a transforming hook (`after_enrich`, `after_format`) returns a value, it replaces the data downstream; returning `void` passes through unchanged

---

## Token Budget

`formatContext()` now accepts `tokenBudget` and `onBudgetExceeded` options for controlling output size.

### Trimming Strategy

When formatted context exceeds the budget, trimming is applied in order (stops as soon as under budget):

1. Truncate all skills to 2000 chars
2. Drop oldest memories (keep most recent 5)
3. Drop skills by reverse match order (least relevant first)

### Budget Warning

If still over budget after all trimming, calls `onBudgetExceeded(warning)`:

```typescript
interface BudgetWarning {
  budget: number;
  actual: number;
  actions: string[];  // What was trimmed
}
```

### Non-Trimmable Sections

Identity sections (AGENTS.md, SOUL.md, USER.md, IDENTITY.md) are **never trimmed**. If identities alone exceed the budget, a warning is emitted but no content is removed.

---

## Provider System

### Registration & Factory Pattern

Providers are registered in a global registry before creating the engine:

```typescript
// Register a provider factory
registerProvider(
  '@dot-ai/cockpit-tasks',
  (options) => new CockpitTaskProvider(options)
);

// Later, create all providers from config
const providers = await createProviders(config);
```

**Why this design?**
- Adapters can register custom providers **before boot**
- Core package knows nothing about specific implementations
- Workspaces own their providers (no hard coupling)

### Default Providers (File-Based)

`registerDefaults()` is now a **no-op** — providers are resolved via dynamic `import()` in `loader.ts`. The following default providers are resolved automatically when referenced in config:

| Name | Class | What It Does |
|------|-------|--------------|
| `@dot-ai/provider-file-memory` | FileMemoryProvider | Searches `.ai/memory/*.md` files for memories |
| `@dot-ai/provider-file-skills` | FileSkillProvider | Lists skills from `.ai/skills/*/SKILL.md` |
| `@dot-ai/provider-file-identity` | FileIdentityProvider | Loads identity files from `.ai/` root (AGENTS.md, etc.) |
| `@dot-ai/provider-rules-routing` | RulesRoutingProvider | Routes based on built-in rules or custom rules config |
| `@dot-ai/provider-file-tasks` | FileTaskProvider | Reads tasks from `.ai/memory/tasks/*.md` files |
| `@dot-ai/provider-file-tools` | FileToolProvider | Reads tools from `.ai/TOOLS.md` |

All defaults implement file-based I/O. Overrides are easy: just register a different provider with the same name.

### Alternative Providers

Other packages provide different backends:

| Package | Provider | Backed By |
|---------|----------|-----------|
| `@dot-ai/provider-sqlite-memory` | SqliteMemoryProvider | SQLite with FTS5 (full-text search) |
| `@dot-ai/cockpit-tasks` | CockpitTaskProvider | Cockpit REST API at `http://localhost:3010` |

**Example:** Kiwi workspace uses Cockpit for tasks:

```yaml
# .ai/dot-ai.yml
tasks:
  use: '@dot-ai/cockpit-tasks'
  with:
    url: 'http://localhost:3010'
    apiKey: '${COCKPIT_API_KEY}'
```

The resolver loads `CockpitTaskProvider` instead of the default file provider.

---

## Adapters

Adapters are the bridge between agents and dot-ai. Each adapter integrates the core engine into a specific agent platform via native hooks.

### adapter-claude

**Package:** `packages/adapter-claude`

**Hooks:** Multi-hook dispatch — `UserPromptSubmit`, `PreCompact`, `Stop`, `PreToolUse` (native Claude Code hooks)

**Flow:**
1. Receives hook event (JSON on stdin)
2. Uses `DotAiRuntime` internally for full pipeline lifecycle
3. Formats output as markdown
4. Injects result into Claude's context (via stdout)

**MCP Server:** `dot-ai-mcp` binary exposes capabilities as MCP tools (memory_recall, memory_store, task_list, etc.)

**File:** `hook.ts` (executable)
**Config:** `hooks/hooks.json` (declares the hooks)

**Special handling:**
- If no prompt text (e.g., SessionStart), injects identities only
- Loads skill content for matched skills (lazy loading)
- `PreToolUse` hook blocks writes to `memory/*.md` files (enforces SQLite-only memory)
- Silent failure: errors logged but don't block the agent

### adapter-openclaw

**Package:** `packages/adapter-openclaw`

**Hook:** `before_agent_start` (native OpenClaw hook)

**Flow:**
1. Uses `DotAiRuntime` internally with `skipIdentities: true` (OpenClaw injects identities separately)
2. Loads custom providers from `pluginConfig.customProviders[]` (if declared in openclaw.json)
3. Calls `buildCapabilities()` to register capabilities as native OpenClaw tools via `api.registerTool()`
4. Caches boot output per workspace (reused across prompts in same session)
5. On each prompt: `runtime.processPrompt() → inject as prependContext`

**Special handling:**
- Skips sub-agent and cron sessions (only main agent gets injected context)
- Session-level caching: one boot per workspace, reused
- Logs enrichment stats (identities, memories, skills injected)

**Custom provider loading:**
Workspaces declare custom providers in `openclaw.json`:

```json
{
  "plugins": {
    "dot-ai": {
      "customProviders": [
        {
          "type": "cockpit",
          "module": "/absolute/path/to/cockpit-tasks.ts"
        }
      ]
    }
  }
}
```

OpenClaw plugin dynamically imports and registers them.

---

## Config: dot-ai.yml

Located at `.ai/dot-ai.yml`, this YAML file declares which provider to use for each domain.

**Format:**

```yaml
memory:
  use: '@dot-ai/provider-file-memory'
  with:
    root: '/path/to/workspace'

skills:
  use: '@dot-ai/provider-file-skills'

identity:
  use: '@dot-ai/provider-file-identity'

routing:
  use: '@dot-ai/provider-rules-routing'
  with:
    defaultModel: 'sonnet'
    rules:
      - labels: ['question', 'lookup']
        model: 'haiku'
        reason: 'simple query'
      - labels: ['architecture', 'planning']
        model: 'opus'
        reason: 'complex reasoning'

tasks:
  use: '@dot-ai/cockpit-tasks'
  with:
    url: '${COCKPIT_URL}'
    apiKey: '${COCKPIT_API_KEY}'

tools:
  use: '@dot-ai/provider-file-tools'
```

**Key features:**
- **Environment variable resolution:** `${VAR_NAME}` is replaced at load time
- **Defaults:** Any missing section defaults to the file-based provider
- **Minimal YAML parser:** No yaml dependency, hand-written parser (lightweight)

**Loading:**

```typescript
const config = await loadConfig(workspaceRoot);
const resolved = resolveConfig(config);  // fills in defaults
```

---

## Convention: .ai/ Directory

The `.ai/` directory is the **workspace context root**. File-based providers read from here. Core doesn't care about structure—that's the provider's concern.

### Standard Structure (file provider assumptions)

```
.ai/
├── AGENTS.md          # Operating rules (IdentityProvider reads)
├── SOUL.md            # Personality
├── USER.md            # User context
├── IDENTITY.md        # AI identity
├── TOOLS.md           # Tool descriptions (ToolProvider reads)
│
├── memory/            # Session memory
│   ├── YYYY-MM-DD.md  # Daily logs (MemoryProvider searches)
│   ├── tasks/         # Task details (TaskProvider reads)
│   │   └── {slug}.md
│   └── research/
│
├── data/              # Structured data only
│   ├── exports/
│   └── imports/
│
├── skills/            # Skill definitions
│   └── {skill-name}/
│       ├── SKILL.md   # Full content (SkillProvider loads)
│       └── ...
│
└── dot-ai.yml         # Provider config
```

**Important:** Core doesn't enforce this structure. It's what **file-based providers** expect. A custom provider (e.g., REST API) might read from completely different locations.

---

## Label Extraction & Vocabulary

Labels are the **bridge between prompt and capabilities**. They enable deterministic matching without LLM calls.

### extractLabels(prompt, vocabulary)

```typescript
export function extractLabels(prompt: string, vocabulary: string[]): Label[]
```

Simple substring matching (case-insensitive):
- Splits prompt into words
- For each word in vocabulary, checks if it appears in prompt
- Returns all matches as `Label[]`

**Example:**
```
Prompt: "I need to debug a complex race condition in our Rust code"
Vocabulary: ["debug", "architecture", "code", "complex", "race-condition", ...]
Labels: ["debug", "complex", "code", "race-condition"]
```

### buildVocabulary(skillLabels, toolLabels)

Called once at boot. Collects all labels from all skills and tools into a Set, then sorts for deterministic ordering.

**Why deterministic matching?**
- Reproducible: same prompt always produces same labels
- No LLM cost: pure string operations
- No hallucination: vocabulary is explicitly defined
- Predictable routing: rules match against known labels

---

## EnrichedContext: The Output

After `enrich()` completes, adapters receive this structure:

```typescript
interface EnrichedContext {
  prompt: string;               // Original prompt
  labels: Label[];              // Extracted labels
  identities: Identity[];        // AGENTS.md, SOUL.md, etc.
  memories: MemoryEntry[];       // Matched memories from search
  skills: Skill[];               // Matched skills (content lazy-loaded)
  tools: Tool[];                 // Matched tools
  routing: RoutingResult;        // Model routing decision
}
```

Adapters then call `formatContext(enriched)` to convert to markdown, which is injected into the agent's context.

---

## Packages Overview

| Package | Location | Purpose | Exports |
|---------|----------|---------|---------|
| **core** | `packages/core/` | Engine, contracts, types, loaders, runtime | `boot()`, `enrich()`, `learn()`, `DotAiRuntime`, `registerProvider()`, interfaces |
| **adapter-claude** | `packages/adapter-claude/` | Claude Code integration | Hook script, format function, `dot-ai-mcp` MCP server |
| **adapter-openclaw** | `packages/adapter-openclaw/` | OpenClaw integration | Plugin object, custom provider loader |
| **sqlite-memory** | `packages/provider-sqlite-memory/` | SQLite memory backend | `SqliteMemoryProvider` class |
| **cockpit-tasks** | *(external — kiwi repo)* | Cockpit API task backend | `CockpitTaskProvider` class |
| **cli** | `packages/cli/` | CLI commands (init, scan, doctor, audit) | Executable `dot-ai` command |

---

## Key Design Decisions

### 1. Why Contracts, Not Steps?

A "step-based" pipeline would look like:

```
loadConfig → registerProviders → boot → enrich → format → inject
```

Instead, we use **contract-based providers**:

```
MemoryProvider | SkillProvider | IdentityProvider | ...
```

**Why?**
- **Composability:** Swap providers without touching core logic
- **Flexibility:** Mix file-based, REST, SQLite as needed
- **Testing:** Mock providers easily, no dependency injection framework needed
- **Ownership:** Workspaces own their implementation choices

### 2. Why Deterministic?

The agent reliability problem: if context is fuzzy, the agent becomes unreliable. With dot-ai:

- Label extraction is **deterministic** (substring match)
- Vocabulary is **static** (built at boot)
- Routing rules are **explicit** (declared in config)
- No randomness, no LLM calls in the pipeline

Result: **Same prompt → Same context → Same behavior** (within agent's generation temperature).

### 3. Why Cache Boot?

Identities, vocabulary, and skill list don't change mid-session. Computing them once at boot:

- **Speeds up enrichment** (no disk I/O on every prompt)
- **Reduces memory churn** (reuse BootCache)
- **Simplifies reasoning** (agent sees consistent skill set)

### 4. Why Lazy-Load Skill Content?

Skills are listed at boot, but content is loaded on-demand:

- **Fast startup:** No parsing every skill file
- **Focused context:** Only skill content actually matched appears in context
- **Scalability:** Works with hundreds of skills

### 5. Why Separate Label Extraction?

Matching `labels` first, before calling providers:

```typescript
// This happens first (no I/O)
const labels = extractLabels(prompt, vocabulary);

// Then use labels as a filter hint for providers
const memories = await memory.search(prompt, labels);
const skills = await skills.match(labels);
```

**Benefits:**
- Providers can optimize: "match these labels" is a hint
- Reduces provider query cost
- Centralized label concept (all providers see same labels)

### 6. Why DotAiRuntime?

Adapters were duplicating the same pipeline wiring (`loadConfig → createProviders → boot → enrich → format`). DotAiRuntime encapsulates this in one reusable class. New adapters only need to instantiate it and call `processPrompt()`.

**Benefits:**
- Single entry point for the full lifecycle
- Consistent hook and capability wiring
- Reduces adapter code from ~50 lines of pipeline setup to 5 lines
- Centralizes token budget, logger, and format options

### 7. Why formatContext Produces Markdown?

Adapters don't care what format context is in. Markdown:

- Is human-readable (useful for debugging)
- Agents naturally parse sections (`## Heading`)
- Is hierarchical (`###` nesting)
- Works everywhere (agents expect text)

---

## Workflow Summary

The recommended path uses `DotAiRuntime`:

1. **Startup (Adapter)**
   - Adapter creates `DotAiRuntime(options)` with workspace root, logger, format options, token budget

2. **Boot (Runtime)**
   - `runtime.boot()` — loads config, creates providers, caches identities + vocabulary, loads hooks, builds capabilities
   - Fires `after_boot` hooks

3. **Process Prompt (Runtime)**
   - `runtime.processPrompt(prompt)` — enrich + format + hooks in one call
   - Extract labels deterministically
   - Query all providers in parallel
   - Fire `after_enrich` hooks (may transform context)
   - Format to markdown with token budget trimming
   - Fire `after_format` hooks (may transform output)
   - Returns `{ formatted, enriched, capabilities }`

4. **Learn (Runtime)**
   - `runtime.learn(response)` — store in memory (skips responses < 50 chars)
   - Fires `after_learn` hooks

5. **Shutdown (Runtime)**
   - `runtime.flush()` — flush logger before process exit (important for CLI hooks)

---

## Type Flow

```
Input: string (raw prompt)
  ↓
[runtime.boot()] → BootCache { identities, vocabulary, skills }
                   → after_boot hooks fire
  ↓
[runtime.processPrompt(prompt)]
  ├─ enrich(prompt, providers, cache) → EnrichedContext
  │    { prompt, labels, identities, memories, skills, tools, routing }
  ├─ after_enrich hooks (may transform context)
  ├─ formatContext(enriched, { tokenBudget }) → string (markdown)
  ├─ after_format hooks (may transform output)
  └─ returns { formatted, enriched, capabilities }
  ↓
[Agent injection] → Agent sees context + capabilities as native tools
  ↓
[runtime.learn(response)] → memory.store() + after_learn hooks
```

---

## Configuration Resolution

When creating providers:

```typescript
const config = loadConfig(workspaceRoot);        // May be empty or partial
const resolved = resolveConfig(config);          // Fills in all defaults

// Example:
{
  memory: { use: '@dot-ai/provider-file-memory' }          // From file
  skills: { use: '@dot-ai/provider-file-skills' }          // From file
  identity: { use: '@dot-ai/provider-file-identity' }      // Default
  routing: { use: '@dot-ai/provider-rules-routing' }       // Default
  tasks: { use: '@dot-ai/cockpit-tasks', ... }    // From file
  tools: { use: '@dot-ai/provider-file-tools' }            // Default
}
```

All missing entries get file-based defaults. Custom providers override as needed.

---

## Adapter Lifecycle

### Claude Code Adapter

```
1. Claude Code fires hook (UserPromptSubmit, PreCompact, Stop, or PreToolUse)
2. hook.ts receives hook event JSON on stdin
3. DotAiRuntime handles pipeline: boot (cached) → processPrompt
4. MCP server (dot-ai-mcp) exposes capabilities as MCP tools
5. PreToolUse blocks writes to memory/*.md (enforces SQLite-only)
6. Output JSON { result: markdown } to stdout
7. Claude Code injects into context
8. Agent sees enriched prompt + capabilities
```

### OpenClaw Adapter

```
1. OpenClaw plugin.register() called at startup
2. DotAiRuntime created with skipIdentities: true
3. Hook: before_agent_start registers with OpenClaw
4. buildCapabilities() registers capabilities as native OpenClaw tools
5. When agent starts:
   - runtime.boot() (cached per workspace)
   - runtime.processPrompt(prompt)
   - Return { prependContext: formatted }
6. OpenClaw prepends to agent context
7. Agent sees enriched prompt + capabilities as tools
```

---

## Error Handling

- **Missing config file:** Returns empty `{}` (all defaults applied)
- **Missing provider in registry:** Falls back to noop provider (returns empty data)
- **Failed provider call:** Logged but doesn't block enrichment (partial context is better than no context)
- **Adapter errors:** Logged to stderr, plugin continues (silent failure pattern)

Philosophy: **Best-effort enrichment.** If memory is unavailable, enrich anyway with what's available. Graceful degradation.

---

## Extending dot-ai

### Create a Custom Provider

1. Implement the contract:

```typescript
export class MyMemoryProvider implements MemoryProvider {
  async search(query: string, labels?: string[]): Promise<MemoryEntry[]> {
    // Your implementation
  }
  async store(entry: Omit<MemoryEntry, 'source'>): Promise<void> {
    // Your implementation
  }
}
```

2. Register in adapter (before `createProviders`):

```typescript
registerProvider('@custom/my-memory', (opts) =>
  new MyMemoryProvider(opts)
);
```

3. Declare in `.ai/dot-ai.yml`:

```yaml
memory:
  use: '@custom/my-memory'
  with:
    url: 'https://api.example.com'
```

### Create a Custom Adapter

Integrate dot-ai into a new agent platform using `DotAiRuntime`:

```typescript
import { DotAiRuntime } from '@dot-ai/core';

// 1. Create runtime
const runtime = new DotAiRuntime({
  workspaceRoot: '/path/to/workspace',
  logger,
  tokenBudget: 8000,
});

// 2. Boot once at startup
await runtime.boot();

// 3. Hook into agent's native event system
agent.onPrompt(async (prompt) => {
  const { formatted, capabilities } = await runtime.processPrompt(prompt);
  // 4. Inject formatted context + register capabilities as native tools
  agent.injectContext(formatted);
  capabilities.forEach(cap => agent.registerTool(cap));
});

// 5. Learn from responses
agent.onResponse(async (response) => {
  await runtime.learn(response);
});

// 6. Flush on exit
process.on('exit', () => runtime.flush());
```

---

## Performance & Optimization

### Boot Caching

- **One-time:** Vocabulary, identities, skill list built once per session
- **Reused:** Every prompt reuses the cache
- **Impact:** Fast enrichment even with hundreds of skills

### Label-Based Filtering

- **Labels as hints:** Providers can filter queries (e.g., `memory.search(query, labels)`)
- **Reduced I/O:** Don't search all memory, search relevant categories
- **Provider-agnostic:** SQLite FTS, file grep, REST filter all benefit

### Lazy-Loaded Skills

- **Boot:** List skills (metadata only)
- **Enrich:** Match labels to skills
- **Format:** Load content for matched skills only
- **Result:** Only necessary skill docs are loaded

### Parallel Provider Calls

```typescript
const [memories, skills, tools, routing] = await Promise.all([
  memory.search(prompt, labels),
  skills.match(labels),
  tools.match(labels),
  routing.route(labels),
]);
```

All providers run concurrently, not sequentially.

---

## Testing & Validation

### Contract Compliance

All provider implementations must satisfy their interface contract:

```typescript
// Test: MemoryProvider.search returns MemoryEntry[]
const results = await memory.search('test', ['label']);
assert(Array.isArray(results));
```

### Config Validation

`config.ts` includes minimal YAML parsing with environment variable resolution.

### Boot Validation

CLI includes `validate()` and `audit()` commands for workspace health.

---

## Summary

dot-ai v4.2 is a **provider-based context enrichment engine**:

1. **Contracts** define what providers must implement
2. **Config** declares which providers to use
3. **Loader** instantiates providers from registry
4. **DotAiRuntime** encapsulates the full pipeline lifecycle
5. **Engine** coordinates the enrichment pipeline
6. **Capabilities** expose provider operations as native agent tools
7. **Hooks** extend the pipeline at 4 key events
8. **Token Budget** trims context to fit agent limits
9. **Adapters** integrate into specific agents
10. **Determinism** ensures reproducible context
11. **Caching** optimizes performance
12. **Extensibility** lets workspaces customize everything

Result: **Agents get complete, consistent workspace context without hard-coding any knowledge.**
