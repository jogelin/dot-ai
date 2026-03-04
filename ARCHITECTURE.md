# dot-ai v4 Architecture

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
│  │  - Claude Code: UserPromptSubmit hook             │    │
│  │  - OpenClaw: before_agent_start hook              │    │
│  └────────────────────────────────────────────────────┘    │
│                       │                                      │
│                       ▼                                      │
│  ┌────────────────────────────────────────────────────┐    │
│  │  dot-ai Core Engine (core package)                │    │
│  │                                                    │    │
│  │  1. loadConfig(.ai/dot-ai.yml)                    │    │
│  │  2. registerDefaults() [or custom providers]      │    │
│  │  3. createProviders(config)                       │    │
│  │  4. boot() → cache identities + vocabulary        │    │
│  │  5. enrich(prompt) → EnrichedContext              │    │
│  │  6. format() → markdown for agent injection       │    │
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
│           .ai/ directory structure                          │
│           (file-based providers' domain)                    │
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
async function boot(providers: Providers): Promise<BootCache>
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
): Promise<void>
```

Called after agent produces a response. Stores learnings in memory:

- Entry type: `'log'` (could also be `'fact'`, `'decision'`, `'pattern'`)
- Date: auto-set to today
- Source: `'learn'`

Adapters decide when to call this (typically not on every response, but on significant outcomes).

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

When `registerDefaults()` is called, these are registered:

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

**Hook:** `UserPromptSubmit` (native Claude Code hook)

**Flow:**
1. Receives hook event (JSON on stdin)
2. Calls core engine: `loadConfig → registerDefaults → createProviders → boot → enrich`
3. Formats output as markdown
4. Injects result into Claude's context (via stdout)

**File:** `hook.ts` (executable)
**Config:** `hooks/hooks.json` (declares the hook)

**Special handling:**
- If no prompt text (e.g., SessionStart), injects identities only
- Loads skill content for matched skills (lazy loading)
- Silent failure: errors logged but don't block the agent

### adapter-openclaw

**Package:** `packages/adapter-openclaw`

**Hook:** `before_agent_start` (native OpenClaw hook)

**Flow:**
1. Registers default providers
2. Loads custom providers from `pluginConfig.customProviders[]` (if declared in openclaw.json)
3. Caches boot output per workspace (reused across prompts in same session)
4. On each prompt: `enrich → load skill content → format → inject as prependContext`

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
│   ├── projects-index.md
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
| **core** | `packages/core/` | Engine, contracts, types, loaders | `boot()`, `enrich()`, `learn()`, `registerProvider()`, interfaces |
| **adapter-claude** | `packages/adapter-claude/` | Claude Code integration | Hook script, format function |
| **adapter-openclaw** | `packages/adapter-openclaw/` | OpenClaw integration | Plugin object, custom provider loader |
| **sqlite-memory** | `packages/sqlite-memory/` | SQLite memory backend | `SqliteMemoryProvider` class |
| **cockpit-tasks** | `packages/cockpit-tasks/` | Cockpit API task backend | `CockpitTaskProvider` class |
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

### 6. Why formatContext Produces Markdown?

Adapters don't care what format context is in. Markdown:

- Is human-readable (useful for debugging)
- Agents naturally parse sections (`## Heading`)
- Is hierarchical (`###` nesting)
- Works everywhere (agents expect text)

---

## Workflow Summary

1. **Startup (Adapter)**
   - Hook fires (UserPromptSubmit or before_agent_start)
   - Adapter calls `registerDefaults()` and `registerCustomProviders()`

2. **Boot (Core)**
   - Load config from `.ai/dot-ai.yml`
   - Create provider instances from registry
   - Load identities, skills, tools, build vocabulary
   - Cache result in `BootCache`

3. **Enrich (Core)**
   - For each prompt:
   - Extract labels deterministically
   - Query all providers in parallel
   - Return `EnrichedContext`

4. **Format (Adapter)**
   - Convert EnrichedContext to markdown
   - Inject into agent's context

5. **Learn (Core)**
   - After significant agent responses
   - Store learnings in memory

---

## Type Flow

```
Input: string (raw prompt)
  ↓
[boot(providers)] → BootCache { identities, vocabulary, skills }
  ↓
[enrich(prompt, providers, cache)] → EnrichedContext
  {
    prompt, labels, identities, memories,
    skills, tools, routing
  }
  ↓
[formatContext(enriched)] → string (markdown)
  ↓
[Agent injection] → Agent sees context
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
1. Claude Code fires UserPromptSubmit hook
2. hook.ts receives hook event JSON on stdin
3. loadConfig, registerDefaults, createProviders, boot, enrich
4. formatContext produces markdown
5. Output JSON { result: markdown } to stdout
6. Claude Code injects into context
7. Agent sees enriched prompt
```

### OpenClaw Adapter

```
1. OpenClaw plugin.register() called at startup
2. registerDefaults() + loadCustomProviders()
3. Hook: before_agent_start registers with OpenClaw
4. When agent starts:
   - Load config, create providers, boot (cached per workspace)
   - Extract workspace context
   - Enrich prompt
   - formatContext produces markdown
   - Return { prependContext: markdown }
5. OpenClaw prepends to agent context
6. Agent sees enriched prompt
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

Integrate dot-ai into a new agent platform:

1. Import core functions:

```typescript
import {
  loadConfig,
  registerDefaults,
  createProviders,
  boot,
  enrich,
} from '@dot-ai/core';
```

2. Hook into agent's native event system
3. Call the pipeline
4. Format and inject context
5. Done!

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

dot-ai v4 is a **provider-based context enrichment engine**:

1. **Contracts** define what providers must implement
2. **Config** declares which providers to use
3. **Loader** instantiates providers from registry
4. **Engine** coordinates the enrichment pipeline
5. **Adapters** integrate into specific agents
6. **Determinism** ensures reproducible context
7. **Caching** optimizes performance
8. **Extensibility** lets workspaces customize everything

Result: **Agents get complete, consistent workspace context without hard-coding any knowledge.**
