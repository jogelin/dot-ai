# PLAN v6 — Unified Extension Architecture

> Everything is an extension. No more providers. No more dot-ai.yml provider config.
> Pi's extension model generalized for multi-agent support.
> **dot-ai is a Headless Agent — behavior without the agent.**

---

## 0. Vision: The Headless Agent

dot-ai is a **Headless Agent** — following the same **headless architecture** pattern that has proven itself across multiple domains:

| Domain | Headless Product | What it decouples |
|--------|-----------------|-------------------|
| UI Components | Radix UI, Headless UI, React Aria, Ark UI | Behavior from rendering |
| CMS | Strapi, Contentful, Sanity, Payload | Content from frontend |
| Commerce | Medusa, Saleor, Commerce.js | Catalog/cart from storefront |
| Auth | Auth.js, Lucia, WorkOS | Authentication from login UI |
| **Agent** | **dot-ai** | **Agent behavior from agent runtime** |

The pattern is always the same:
1. **Core** — pure logic, programmatic API, no opinion on delivery
2. **Adapter** — connects core to the consumer (browser, storefront, agent)
3. **Consumer** — free to choose their own stack

dot-ai provides **agent behavior** (context enrichment, memory, skills matching, routing, tool registration, learning) without imposing any **agent**. The adapter brings the agent (Pi, Claude Code, OpenClaw, Cursor, Copilot).

| Headless (general) | dot-ai (Headless Agent) |
|------------|----------------------|
| Behavior / data / logic | Behavior (enrich, memory, routing, tools, learning) |
| No rendering / no frontend / no UI | No agent / no LLM / no runtime |
| Adapter = framework (React, Vue, Storefront, ...) | Adapter = Agent (Pi, Claude Code, OpenClaw, Sync) |
| Exposes API (props, REST, events) | Exposes events + tool registry |
| Consumer decides presentation | Adapter decides capability exposure |
| Composable primitives | Composable extensions |
| Works anywhere the adapter runs | Works with any AI agent |

**Key implication:** dot-ai core has zero opinion about:
- Which LLM to use (routing is advisory, adapter decides)
- How tools are exposed (native vs CLI vs text — adapter decides)
- How context is injected (messages vs hook stdout vs rules file — adapter decides)
- What the agent looks like (Pi has TUI, Claude Code has CLI, Copilot has IDE)

dot-ai core only cares about: **what behavior is available** (via extensions) and **firing events in the right order**.

---

## 1. Principles

1. **One system** — Extensions are the only plugin mechanism (no separate providers, hooks)
2. **Pi-compatible** — Same factory pattern, same `on(event)` + `registerTool()` + `registerCommand()` API. Same config format (`settings.json`). Same naming conventions where possible.
3. **Multi-agent** — Adapters map extension capabilities to each agent's native features
4. **Graceful degradation** — Every capability degrades per adapter tier (native → CLI+skill → text-only → skip). See Section 11.
5. **Pi as library** — Strategy B now (structural compatibility), Strategy A later (shared package)
6. **Core is pure orchestrator** — Core does NOT scan skills, open databases, or do anything domain-specific. It discovers extensions, loads them, fires events, aggregates results, formats output. Everything else is an extension's job.
7. **Skills-First for limited adapters** — Adapters that don't support `registerTool` natively (Claude Code, Sync) degrade tools to CLI wrappers + auto-generated skills. This is an adapter concern, not a core concern.
8. **`dot-ai` CLI is a global feature** — The CLI (`@dot-ai/cli`) works in any workspace, for any adapter. Not specific to Claude Code.

---

## 2. Core vs Extensions — Separation of Concerns

### 2.1 What Core Does (and ONLY what core does)

| Responsibility | Core does it? | How |
|---------------|---------------|-----|
| Discover extensions (directories + config) | Yes | Scan `.ai/extensions/`, `~/.ai/extensions/`, settings.json, npm packages |
| Load extensions (call factories) | Yes | `jiti` import, call factory with `ExtensionAPI` |
| Fire events in order | Yes | Event bus with emission patterns |
| Aggregate results from events | Yes | Collect sections, chain-transform, short-circuit |
| Build vocabulary from contributed labels | Yes | Aggregates labels from `resources_discover` results |
| Token budget trimming | Yes | Sections have priority (set by extensions), trimming is core logic |
| Format output (assemble sections) | Yes | Ordered by priority, markdown assembly |
| Maintain tool registry | Yes | Stores ToolDefinitions from `registerTool()` calls |
| Expose tool registry to adapters | Yes | Adapters query the registry to decide HOW to expose tools |

### 2.2 What Core Does NOT Do

| Responsibility | Who does it? | Via which event? |
|---------------|-------------|-----------------|
| Scan `.ai/skills/` | `ext-file-skills` | `resources_discover` |
| Scan `.ai/tools/` | `ext-file-tools` | `resources_discover` |
| Load identity files | `ext-file-identity` | `resources_discover` |
| Open SQLite database | `ext-sqlite-memory` | `session_start` |
| Connect to REST APIs | `cockpit-tasks` (custom) | `session_start` |
| Match labels to skills | `ext-file-skills` | `context_enrich` |
| Search memory | `ext-sqlite-memory` | `context_enrich` |
| Route to model tier | `ext-rules-routing` | `route` |
| Store learnings | `ext-sqlite-memory` | `agent_end` |
| Generate skill files | Adapter (not core!) | Adapter-specific |
| Decide how to expose tools | Adapter (not core!) | Reads core tool registry |

### 2.3 Boot Sequence (core perspective)

```
boot():
  1. Read settings.json → get extension list + their configs
  2. Discover extensions:
     - Local: .ai/extensions/
     - Global: ~/.ai/extensions/
     - Config: listed in settings.json
     - NPM: packages with "dot-ai" field in package.json
  3. Load each extension (in config order): import via jiti, call factory(api)
     - Each extension registers its event handlers and tools via api
  4. Fire 'resources_discover' (collect-all)
     - Extensions contribute: resource paths + labels
     - Core aggregates ALL contributed labels → builds vocabulary
  5. Fire 'session_start' (fire-and-forget)
     - Extensions do their own init (open DB, validate connections, etc.)
  6. Notify adapter: "boot complete, here's the tool registry"
     - Adapter decides how to expose each tool (native, CLI, skill, text)
```

**Key insight:** Core owns the tool registry. Adapters own the tool exposure strategy.

---

## 3. Event Inventory — Unified from Pi + dot-ai + Claude Code + OpenClaw

### 3.1 Lifecycle Events

| Event | Pattern | Pi | Claude Code | OpenClaw | Sync | Description |
|-------|---------|-----|-------------|----------|------|-------------|
| `session_start` | fire-and-forget | session_start | SessionStart hook | service.start | boot() | Session begins, extensions init |
| `session_end` | fire-and-forget | session_shutdown | SessionEnd hook | service.stop | — | Session ends, cleanup |

### 3.2 Resource Events

| Event | Pattern | Pi | Claude Code | OpenClaw | Sync | Description |
|-------|---------|-----|-------------|----------|------|-------------|
| `resources_discover` | collect-all | resources_discover | plugin skills scan | — | — | Extensions declare resources and contribute labels to vocabulary |

**This is how all resources are provided.** An extension returns paths + labels. Core collects all contributions and builds the vocabulary/index. Core does NOT know about skills, tools, or identities — it only knows about "resources with labels."

### 3.3 Context Events (the enrichment pipeline)

| Event | Pattern | Pi | Claude Code | OpenClaw | Sync | Description |
|-------|---------|-----|-------------|----------|------|-------------|
| `label_extract` | chain-transform | — (new) | — | — | — | Extract/add labels from prompt. Default: regex matching against vocabulary |
| `context_enrich` | collect-all | before_agent_start (messages) | UserPromptSubmit (result) | before_agent_start (prependContext) | one-shot format | Each extension contributes context sections |
| `context_modify` | chain-transform | context (messages array) | — | — | — | Rewrite full message array before LLM call (rich tier only) |
| `route` | first-result | — (new, but model_select observes) | — | — | — | Determine model tier from labels. First extension to return wins. |

**Key insight:** `context_enrich` replaces both `context_inject` and Pi's `before_agent_start`. Each extension returns `{ sections?: Section[], systemPrompt?: string }`. Sections have priority for ordering and are subject to token budget trimming.

### 3.4 Input Events

| Event | Pattern | Pi | Claude Code | OpenClaw | Sync | Description |
|-------|---------|-----|-------------|----------|------|-------------|
| `input` | chain-transform + short-circuit | input | UserPromptSubmit (partial) | — | — | Transform or consume user input before processing |

### 3.5 Tool Events

| Event | Pattern | Pi | Claude Code | OpenClaw | Sync | Description |
|-------|---------|-----|-------------|----------|------|-------------|
| `tool_call` | short-circuit (block) | tool_call | PreToolUse hook | — | — | Before tool execution. Can block. |
| `tool_result` | chain-transform | tool_result | PostToolUse hook | — | — | After tool execution. Can modify result. |

### 3.6 Agent Loop Events

| Event | Pattern | Pi | Claude Code | OpenClaw | Sync | Description |
|-------|---------|-----|-------------|----------|------|-------------|
| `agent_start` | fire-and-forget | agent_start | — | — | — | Agent loop begins |
| `agent_end` | fire-and-forget | agent_end | Stop hook | after_agent_end | — | Agent loop ends. Learn/store here. |
| `turn_start` | fire-and-forget | turn_start | — | — | — | LLM turn begins |
| `turn_end` | fire-and-forget | turn_end | — | — | — | LLM turn ends |

### 3.7 Message Events (rich tier, Pi only for now)

| Event | Pattern | Pi | Claude Code | OpenClaw | Sync | Description |
|-------|---------|-----|-------------|----------|------|-------------|
| `message_start` | fire-and-forget | message_start | — | — | — | LLM starts generating |
| `message_update` | fire-and-forget | message_update | — | — | — | Streaming token update |
| `message_end` | fire-and-forget | message_end | — | — | — | LLM finishes generating |

### 3.8 Session Management Events (Pi-specific, passthrough)

| Event | Pi equivalent | Description |
|-------|---------------|-------------|
| `session_before_switch` | session_before_switch | Can cancel |
| `session_switch` | session_switch | After switch |
| `session_before_compact` | session_before_compact | Can cancel, provide custom compaction |
| `session_compact` | session_compact | After compaction |

These are Pi-specific. Other adapters don't fire them. Extensions that use them only work on Pi.

---

## 4. Registration API

### 4.1 ExtensionAPI (passed to factory)

```typescript
interface ExtensionAPI {
  // === Event subscription ===
  on(event: string, handler: (event: any, ctx: ExtensionContext) => any): void;

  // === Register capabilities ===
  registerTool(tool: ToolDefinition): void;
  registerCommand(command: CommandDefinition): void;

  // === Inter-extension communication ===
  events: EventBus;

  // === Extension config (from settings.json or package settings) ===
  config: Record<string, unknown>;
}
```

**Removed vs current:** No more `providers` property. Extensions that need memory/tasks/etc access them via `ctx` or inter-extension events.

**Removed vs Pi:** No `registerShortcut`, `registerFlag`, `registerMessageRenderer`, `registerProvider` (model), `sendMessage`, `setModel`, etc. Those are Pi-specific and stay in the Pi adapter's extended API.

### 4.2 ExtensionContext (passed to event handlers)

```typescript
interface ExtensionContext {
  // Core
  workspaceRoot: string;
  events: EventBus;
  labels: Label[];           // Current prompt labels (available after label_extract)

  // Agent capabilities (adapter-provided, may be undefined)
  agent?: {
    abort(): void;
    getContextUsage(): { tokens: number; percent: number } | undefined;
    getSystemPrompt(): string;
    // Pi extends with: ui, sessionManager, model, etc.
    // Claude Code extends with: nothing (stateless hooks)
    [key: string]: unknown;
  };
}
```

### 4.3 ToolDefinition (aligned with Pi)

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;   // JSON Schema
  execute(input: Record<string, unknown>, ctx: ExtensionContext): Promise<ToolResult>;
  promptSnippet?: string;                // One-liner for system prompt
  promptGuidelines?: string;             // Detailed guidelines
}

interface ToolResult {
  content: string;
  details?: unknown;
  isError?: boolean;
}
```

### 4.4 CommandDefinition

```typescript
interface CommandDefinition {
  name: string;
  description: string;
  parameters?: CommandParameter[];
  execute(args: Record<string, string>, ctx: ExtensionContext): Promise<CommandResult | void>;
  completions?(prefix: string): string[] | Promise<string[]>;
}
```

---

## 5. Extension Config — Discovery and Configuration

### 5.1 Config Format: `settings.json` (Pi-compatible)

Following Pi's convention. File location: `.ai/settings.json`

```json
{
  "extensions": [
    { "use": "@dot-ai/ext-file-skills" },
    { "use": "@dot-ai/ext-file-identity" },
    {
      "use": "@dot-ai/ext-sqlite-memory",
      "with": { "path": ".ai/memory.db" }
    },
    { "use": "@dot-ai/ext-rules-routing" },
    { "use": "@dot-ai/ext-file-tools" },
    {
      "use": "@dot-ai/cockpit-tasks",
      "with": {
        "url": "http://localhost:3010",
        "apiKey": "${COCKPIT_API_KEY}"
      }
    }
  ]
}
```

### 5.2 Discovery Sources (in order)

1. **`.ai/settings.json`** — explicit list with config and order
2. **`.ai/extensions/`** — local directory, auto-discovered
3. **`~/.ai/extensions/`** — global directory, auto-discovered
4. **npm packages** with `"dot-ai"` field in `package.json` — auto-discovered

`settings.json` is **optional**. Without it, dot-ai works with pure auto-discovery. Extensions from auto-discovery load after settings.json extensions.

### 5.3 Extension Load Order

1. Extensions listed in `settings.json` → in declaration order
2. Local `.ai/extensions/` → alphabetical
3. Global `~/.ai/extensions/` → alphabetical
4. npm auto-discovered → alphabetical

Order matters for event handling: earlier extensions get called first for chain-transform and first-result events.

---

## 6. How Current Providers Become Extensions

### 6.1 @dot-ai/ext-sqlite-memory (was: provider-sqlite-memory)

```
on('session_start')              → open DB connection
on('session_end')                → run consolidate(), close DB

on('context_enrich')             → search prompt labels in memory, return Section[]
on('agent_end')                  → store significant response (learn phase)

registerTool('memory_recall')    → search DB, return formatted results
registerTool('memory_store')     → store entry with dedup/scoring
```

### 6.2 @dot-ai/ext-file-skills (was: provider-file-skills)

```
on('resources_discover')         → scan .ai/skills/*/SKILL.md, return skillPaths[] + labels
                                   (contributes labels to vocabulary)
on('context_enrich')             → match labels against skill index, return Section[]
                                   (progressive: metadata at boot, content on match)
```

### 6.3 @dot-ai/ext-file-identity (was: provider-file-identity)

```
on('resources_discover')         → declare identity files (AGENTS.md, SOUL.md, etc.)
on('context_enrich')             → return identity Sections (high priority, never trimmed)
                                   lazy-load project identities when project label matches
```

### 6.4 @dot-ai/ext-rules-routing (was: provider-rules-routing)

```
on('route')                      → match labels against rules, return { model, reason }
on('context_enrich')             → if model != default, append routing hint Section
```

### 6.5 @dot-ai/ext-file-tools (was: provider-file-tools)

```
on('resources_discover')         → scan .ai/tools/*.yaml, contribute labels to vocabulary
on('context_enrich')             → match labels, return tool hint Sections
```

### 6.6 @dot-ai/ext-file-tasks (was: provider-file-tasks)

```
registerTool('task_list')        → list tasks with filters
registerTool('task_create')      → create task
registerTool('task_update')      → update task

on('context_enrich')             → inject active tasks summary (in_progress, recent pending)
```

### 6.7 @dot-ai/cockpit-tasks (kiwi custom, was: cockpit-tasks provider)

Same as ext-file-tasks but backed by Cockpit REST API instead of JSON files.

### 6.8 @dot-ai/ext-file-prompts (was: provider-file-prompts)

```
on('resources_discover')         → scan .ai/prompts/*.md, return promptPaths[]
registerCommand(per template)    → each prompt template becomes a slash command
```

---

## 7. `dot-ai` CLI — Global Tool Execution

### 7.1 Purpose

The `dot-ai` CLI (`@dot-ai/cli` npm package) is a **global feature** that allows any agent (via any adapter) to execute registered tools from the command line. It's the universal fallback for adapters that don't support `registerTool` natively.

### 7.2 How It Works

```bash
# The dot-ai CLI is a thin wrapper:
dot-ai <domain> <action> [args...]

# Examples:
dot-ai memory recall "react hooks"     # → boots runtime, calls memory_recall tool
dot-ai memory store "learned X"        # → boots runtime, calls memory_store tool
dot-ai tasks list --status=pending     # → boots runtime, calls task_list tool
dot-ai tasks create "Fix bug #42"      # → boots runtime, calls task_create tool
dot-ai cache clear                     # → clears .ai/.cache/

# The CLI uses the boot cache (.ai/.cache/) for fast startup
```

### 7.3 CLI Boot Flow

```
1. Detect workspace root (find nearest .ai/ directory)
2. Check boot cache (.ai/.cache/boot.json)
   - If valid → load cached tool registry + extension config
   - If invalid → full boot (discover, load, resources_discover)
3. Parse CLI args → find matching tool in registry
4. Execute tool.execute(parsedInput, ctx)
5. Print result to stdout (formatted for terminal or JSON with --json flag)
```

### 7.4 Who Uses the CLI

| Adapter | Uses CLI? | Why |
|---------|----------|-----|
| Pi | No | Has native `registerTool` |
| OpenClaw | No | Has native `registerTool` |
| Claude Code | Yes | No native tool registration. Agent calls CLI via Bash. |
| Sync | No | View-only, no interactivity |
| Any future adapter without native tools | Yes | Universal fallback |

---

## 8. Skills-First Strategy for Limited Adapters

### 8.1 The Problem

Some adapters (Claude Code, Sync) don't support `registerTool` natively. The agent can't call extension-provided tools directly. But these tools still need to be accessible.

### 8.2 Why Not MCP (for Claude Code)

Research and analysis of Pi, OpenClaw, mitsuhiko's approach, and mcporter confirm:

| Problem with MCP | Impact |
|-----------------|--------|
| Tool schemas consume context tokens | ~500-2000 tokens/tool, permanent in context |
| Schema changes invalidate KV cache | Agent repays full token cost |
| Persistent process required | Process management complexity |
| Token overhead degrades tool selection | Accuracy drops from 88% to 79% at scale |

**Skills are static markdown** — they stay warm in the KV cache, load on-demand (only when labels match), and cost ~200 tokens vs ~2500 for 5 MCP tools.

### 8.3 How Adapters Expose Tools (Degradation Strategy)

When an extension calls `registerTool()`, the core stores the `ToolDefinition` in its registry. Then each **adapter** decides how to expose it:

```
Extension:  registerTool('memory_recall', { description, parameters, execute })
                    ↓
Core:       stores ToolDefinition in tool registry
                    ↓
Adapter queries registry and decides:

  Pi adapter:          → pi.registerTool(toolDef)
                         Agent sees native tool, calls it directly
                         FULL FIDELITY

  OpenClaw adapter:    → api.registerTool(toolDef)
                         Agent sees native tool, calls it directly
                         FULL FIDELITY

  Claude Code adapter: → generates skill markdown from ToolDefinition
                         Skill says: "Use `dot-ai memory recall "query"`"
                         Agent calls CLI via Bash
                         DEGRADED: extra hop through CLI, skill loaded on-demand

  Sync adapter:        → writes tool description in rules file
                         "Available tool: memory_recall - search memories"
                         Agent sees text only, cannot execute
                         VERY DEGRADED: informational only
```

### 8.4 Skill Auto-Generation (Adapter Concern)

The Claude Code adapter generates skills from the tool registry. **Core never generates skills.**

```typescript
// Claude Code adapter (pseudocode)
function generateToolSkills(toolRegistry: ToolDefinition[]): SkillFile[] {
  // Group tools by domain (e.g., memory_recall + memory_store → "memory")
  const groups = groupByDomain(toolRegistry);

  return groups.map(group => ({
    path: `skills/dot-ai-${group.domain}.md`,
    content: formatSkillMarkdown(group.tools),
    labels: group.tools.flatMap(t => extractLabels(t.name, t.description)),
  }));
}
```

Generated skill example:
```markdown
---
labels: [memory, recall, store, remember, forget]
---
# dot-ai Memory

Use the `dot-ai` CLI to manage workspace memory.

## Recall memories
```bash
dot-ai memory recall "search query"
```
Returns matching memories ranked by relevance.

## Store a memory
```bash
dot-ai memory store "content to remember"
```
Saves information for future sessions.
```

### 8.5 When MCP Is Unavoidable

For rare cases where MCP is the only option (e.g., an extension wraps an external MCP server), use the **mcporter pattern**: the agent calls `mcporter call <server> <tool>` from Bash. The MCP server is never loaded natively into the agent's context.

---

## 9. Caching Strategy

### 9.1 Why Cache Is Needed

On Claude Code, each hook invocation creates a **new process** that boots a **new runtime**. Without cache, every prompt triggers:
- Config file read
- Extension discovery (filesystem scan)
- Extension loading (jiti imports)
- `resources_discover` event (extensions scan their directories)
- Vocabulary construction

This full boot is ~100-500ms per invocation. With Skills-First (all hooks, no persistent MCP), caching is critical.

### 9.2 Cache Location

```
.ai/.cache/
├── boot.json          # vocabulary, resource index, extension list, tool registry
├── boot.checksum      # hash of: settings.json mtime + extensions dir mtime + skills dir mtimes
```

**Why `.ai/.cache/`:**
- In the workspace (not global) — each project has its own cache
- Git-ignorable (add `.ai/.cache/` to `.gitignore`)
- Easy to find and clean
- Follows the `.ai/` convention

### 9.3 Cache Invalidation

```
Automatic:
  - On boot, compute checksum of:
    - .ai/settings.json mtime
    - .ai/extensions/ dir mtime
    - Each extension's source file mtime
    - (Note: skill dir mtimes are extension-contributed, included in resources_discover cache)
  - If checksum differs from boot.checksum → invalidate, full reboot
  - If checksum matches → load boot.json, skip discovery + resource scan

Manual:
  - dot-ai cache clear          # CLI command
  - rm -rf .ai/.cache/          # direct
```

### 9.4 Scope

Cache benefits **all hooks**, not just tool execution:
- `UserPromptSubmit`: vocabulary + skill index already ready → skip filesystem scan
- `PreToolUse`: extension list already loaded → fast evaluation
- `Stop`: DB path already resolved → learn direct
- `SessionStart`: can skip full discovery if cache is warm

### 9.5 What Gets Cached vs What Doesn't

| Cached | Not cached (always fresh) |
|--------|--------------------------|
| Extension list + load order | Memory search results |
| Vocabulary (labels) | Task queries |
| Skill index (paths + metadata) | Prompt processing |
| Tool registry (names + schemas) | Tool call blocking decisions |
| Identity file paths | Learning/storage |
| Config values | |

---

## 10. Runtime Pipeline

```
boot():
  1. Read .ai/settings.json → get extension list + their configs
  2. Check cache (.ai/.cache/boot.json):
     - If valid → load cached state, skip to step 6
     - If invalid → continue with full boot
  3. Discover extensions (local dirs + config + npm)
  4. Load each via jiti (in order), call factory with ExtensionAPI
  5. Fire 'resources_discover' (collect-all)
     - Extensions contribute: resource paths + labels
     - Core aggregates labels → builds vocabulary
     - Write cache to .ai/.cache/
  6. Fire 'session_start' (fire-and-forget)
     - Extensions do their own init (open DB, validate connections, etc.)
  7. Adapter reads tool registry → decides how to expose each tool

processPrompt(prompt):
  1. Fire 'label_extract' → extract labels from prompt against vocabulary
     (default handler does regex matching, extensions can add custom labels)
  2. Fire 'route' (first-result) → determines model tier
  3. Fire 'context_enrich' (collect-all) → each extension returns Section[]
     - Identity ext: persona docs (priority 100, never trimmed)
     - Memory ext: relevant memories (priority 80)
     - Skills ext: matched skill content (priority 60, progressive load)
     - Tasks ext: active tasks summary (priority 50)
     - Tools ext: tool hints (priority 40)
     - Routing ext: model hint (priority 30)
  4. Assemble sections by priority, apply token budget trimming
  5. Return { formatted, labels, routing, tools, commands }

processInput(input):     [v5.1+]
  1. Fire 'input' → chain-transform or short-circuit
  2. If not handled, pass to processPrompt

fireToolCall(event):
  1. Fire 'tool_call' → short-circuit on block
  2. Return block decision or null

fireToolResult(event):
  1. Fire 'tool_result' → chain-transform content/details
  2. Return modified result

learn(response):
  1. Fire 'agent_end' with response
  (Memory extension handles storage in its handler)

shutdown():
  1. Fire 'session_end'
  (Extensions close connections, flush data)
```

---

## 11. Graceful Degradation Matrix

This is the comprehensive view of how every dot-ai capability degrades across adapters.

### 11.1 Event Degradation

| Event | Pi | OpenClaw | Claude Code | Sync |
|-------|-----|----------|-------------|------|
| `session_start` | Native event | First `before_agent_start` | SessionStart hook | At CLI run |
| `session_end` | Native event | `stop()` callback | SessionEnd hook | — skip |
| `resources_discover` | Native event | At boot scan | At boot (cached) | At CLI run |
| `label_extract` | Before `before_agent_start` | Before `before_agent_start` | Inside UserPromptSubmit | At CLI run |
| `context_enrich` | → messages + systemPrompt | → `prependContext` | → hook stdout `{result}` | → rules file |
| `context_modify` | Native (rewrite messages) | — skip | — skip | — skip |
| `route` | → `pi.setModel()` | → text hint (advisory) | → text hint (advisory) | → text in rules |
| `input` | Native (chain + short-circuit) | — skip | Partial (UserPromptSubmit) | — skip |
| `tool_call` | Native (can block) | — skip (check API) | PreToolUse hook (can block) | — skip |
| `tool_result` | Native (chain-transform) | — skip | PostToolUse hook (observe) | — skip |
| `agent_start` | Native | — skip | — skip | — skip |
| `agent_end` | Native | `after_agent_end` | Stop hook | — skip |
| `turn_start/end` | Native | — skip | — skip | — skip |
| `message_*` | Native | — skip | — skip | — skip |
| Pi session events | Native | — skip | — skip | — skip |

### 11.2 Capability Degradation

| Capability | Pi (Tier 1) | OpenClaw (Tier 2) | Claude Code (Tier 3) | Sync (Tier 4) |
|-----------|-------------|-------------------|---------------------|---------------|
| **registerTool** | Native tool in agent toolset | Native tool in agent toolset | **Auto-generated skill** teaching agent to call `dot-ai` CLI via Bash | **Text description** in rules file (informational only) |
| **registerCommand** | Native slash command | — skip (check API) | Plugin command (plugin.json) | — skip |
| **Tool execution** | Agent calls tool directly, gets result | Agent calls tool directly, gets result | Agent runs `dot-ai <cmd>` in Bash, reads stdout | No execution possible |
| **Context injection** | Messages + system prompt modification | Prepend context string | Hook stdout → agent sees enriched prompt | Static rules file content |
| **Message rewriting** | Full message array modification | Not possible | Not possible | Not possible |
| **Input transformation** | Chain-transform + short-circuit | Not possible | Partial (can modify prompt result) | Not possible |
| **Tool blocking** | Block + reason | Not possible (check) | Block + reason via hook | Not possible |
| **Tool result modification** | Chain-transform result | Not possible | Observe only (cannot modify for LLM) | Not possible |
| **Model routing** | Set model directly | Advisory text | Advisory text | Advisory text |
| **Learning (agent_end)** | Full response access | Full response access | Response via Stop hook | No learning |
| **Streaming** | Token-level updates | Not possible | Not possible | Not possible |

### 11.3 Degradation Tiers

```
Tier 1 (Pi):        Full fidelity. All events, native tools, message control.
Tier 2 (OpenClaw):  Good fidelity. Most events, native tools, no message control.
Tier 3 (Claude Code): Degraded. Events via hooks, tools via CLI+skills, no message control.
Tier 4 (Sync):      View-only. Static snapshot, no interactivity, no learning.
```

### 11.4 Dynamic Extensions: Can Extensions Add Tools at Runtime?

Yes. Extensions can call `registerTool()` at any time (including in event handlers). The tool is added to the core registry immediately.

**How this works per adapter:**

| Adapter | Dynamic tool registration |
|---------|--------------------------|
| Pi | Tool appears in agent's toolset immediately (next turn) |
| OpenClaw | Tool appears immediately |
| Claude Code | **Requires skill regeneration.** Adapter must regenerate the skill markdown and the agent will see it on next `context_enrich`. This means dynamically added tools have a one-prompt delay. |
| Sync | Next sync run will include the new tool description |

---

## 12. Adapter Mapping (detailed)

### 12.1 Pi Adapter

Pi is the richest adapter — near 1:1 mapping.

| dot-ai | Pi mechanism |
|--------|-------------|
| `session_start` | Pi `session_start` event |
| `session_end` | Pi `session_shutdown` event |
| `resources_discover` | Pi `resources_discover` event (native!) |
| `context_enrich` | Pi `before_agent_start` → inject as messages + systemPrompt |
| `context_modify` | Pi `context` event → rewrite messages array |
| `label_extract` | Run before `before_agent_start`, pass labels in ctx |
| `route` | Result influences model selection via `pi.setModel()` |
| `input` | Pi `input` event |
| `tool_call` | Pi `tool_call` event via wrapper |
| `tool_result` | Pi `tool_result` event via wrapper |
| `agent_start/end` | Pi `agent_start/end` events |
| `turn_start/end` | Pi `turn_start/end` events |
| `message_*` | Pi `message_*` events |
| `registerTool` | Pi `pi.registerTool()` — native |
| `registerCommand` | Pi `pi.registerCommand()` — native |
| Pi-only: shortcuts, flags, renderers, providers | Extended PiExtensionAPI |

**Pi adapter strategy:** dot-ai adapter IS a Pi extension. It registers itself via Pi's extension API and bridges all events.

### 12.2 Claude Code Adapter (Skills-First, No MCP)

```
Claude Code Plugin Structure:
├── plugin.json           # declares hooks + skills directory
├── hooks/
│   ├── session-start.js  # fire session_start, warm cache
│   ├── prompt-submit.js  # label_extract + context_enrich + format
│   ├── pre-tool-use.js   # fire tool_call (blocking)
│   ├── post-tool-use.js  # fire tool_result
│   └── stop.js           # fire agent_end (learn)
├── skills/
│   ├── dot-ai-memory.md  # auto-generated: teaches agent to use `dot-ai memory` CLI
│   └── dot-ai-tasks.md   # auto-generated: teaches agent to use `dot-ai tasks` CLI
└── (dot-ai CLI installed globally or via npx)

NO MCP SERVER. No persistent process. No tool schemas in context.
```

**Caching:** Boot cache in `.ai/.cache/` eliminates redundant filesystem scans across hook invocations.

### 12.3 OpenClaw Adapter

| dot-ai | OpenClaw mechanism | Degradation |
|--------|-------------------|-------------|
| `session_start` | Plugin `api.on('before_agent_start')` first call | Cache runtime after first boot |
| `session_end` | Service `stop()` callback | OK |
| `resources_discover` | At boot, scan | Static after boot |
| `context_enrich` | `before_agent_start` → return `{ prependContext }` | OK, full pipeline |
| `context_modify` | — | Not possible |
| `label_extract` | Inside before_agent_start | OK |
| `route` | Inside before_agent_start, as text hint | Advisory only |
| `input` | — | Not possible |
| `tool_call` | — (check if OpenClaw has before_tool_use) | May not be possible |
| `tool_result` | — | Not possible |
| `agent_end` | `api.on('after_agent_end')` | OK |
| `registerTool` | `api.registerTool()` — native | OK |
| `registerCommand` | — (check OpenClaw API) | May not be possible |

### 12.4 Sync Adapter (Cursor / Copilot / Windsurf)

| dot-ai | Sync mechanism | Degradation |
|--------|---------------|-------------|
| `resources_discover` | At CLI run time | One-shot |
| `context_enrich` | Write to rules file | Static snapshot |
| `route` | Text hint in rules file | Advisory only |
| Everything else | — | Not possible |
| `registerTool` | Text hints in rules file | Description only, not interactive |
| `registerCommand` | — | Not possible |

**Sync is view-only.** It generates a snapshot of the enriched context as a markdown file. No interactivity, no learning, no tool execution.

---

## 13. Adapter Capabilities Matrix (code)

```typescript
const ADAPTER_CAPABILITIES = {
  pi: new Set([
    'session_start', 'session_end',
    'resources_discover',
    'label_extract', 'context_enrich', 'context_modify', 'route',
    'input',
    'tool_call', 'tool_result',
    'agent_start', 'agent_end',
    'turn_start', 'turn_end',
    'message_start', 'message_update', 'message_end',
    // Pi-specific
    'session_before_switch', 'session_switch',
    'session_before_compact', 'session_compact',
    'model_select', 'user_bash',
  ]),
  'claude-code': new Set([
    'session_start', 'session_end',
    'resources_discover',
    'label_extract', 'context_enrich', 'route',
    'tool_call', 'tool_result',
    'agent_end',
  ]),
  openclaw: new Set([
    'session_start', 'session_end',
    'resources_discover',
    'label_extract', 'context_enrich', 'route',
    'agent_end',
  ]),
  sync: new Set([
    'resources_discover',
    'context_enrich', 'route',
  ]),
};

// Tool exposure strategy per adapter
const TOOL_STRATEGY = {
  pi: 'native',           // registerTool → agent sees tool directly
  openclaw: 'native',     // registerTool → agent sees tool directly
  'claude-code': 'cli',   // registerTool → generate skill + CLI subcommand
  sync: 'text',           // registerTool → description in rules file
};
```

---

## 14. What Gets Deleted

| Current file/concept | Fate |
|---------------------|------|
| `contracts.ts` (MemoryProvider, SkillProvider, etc.) | **DELETE** — no more provider interfaces |
| `loader.ts` (provider registry, globalThis hack) | **DELETE** — extensions loaded by extension-loader |
| `engine.ts` (boot, enrich, learn) | **REWRITE** — becomes event-driven pipeline in runtime |
| `hooks.ts` (after_boot, after_enrich, etc.) | **DELETE** — replaced by extension events |
| `config.ts` (provider config parsing) | **SIMPLIFY** — only parse extension list + workspace config |
| `capabilities.ts` (provider-to-tool bridge) | **SIMPLIFY** — extensions register tools directly |
| `format.ts` | **REWRITE** — becomes Section assembler with budget trimming |
| `dot-ai.yml` | **REPLACE** with `.ai/settings.json` |
| All `provider-*` packages | **RENAME to ext-*** and rewrite as extensions |
| MCP server code in Claude Code adapter | **DELETE** — replaced by CLI + skills |

### What Gets Kept (adapted)

| Current | Kept as |
|---------|---------|
| `extension-types.ts` | Expanded with new events |
| `extension-api.ts` | Simplified (no providers property) |
| `extension-loader.ts` | Enhanced (settings.json-based loading) |
| `extension-runner.ts` | Enhanced (new emission patterns: collect-sections, first-result) |
| `runtime.ts` | Rewritten as event pipeline orchestrator |
| `labels.ts` | Kept, used by default label_extract handler |
| `nodes.ts` | Kept, used by resource discovery |
| `package-manager.ts` | Kept for npm extension installation |

---

## 15. Migration Plan

### Phase 1: Core Extension System (expand)
- Add new events: `resources_discover`, `label_extract`, `context_enrich`, `route`, `input`
- Add new emission patterns: `collect-sections`, `first-result`
- Add `Section` type with priority and trimming rules
- Add `config` property to ExtensionAPI
- Update ExtensionContext with `labels` and `agent`
- Add `registerCommand` to ExtensionAPI
- Add tool registry to core (stores ToolDefinitions, exposes to adapters)

### Phase 2: Convert providers to extensions
- `ext-file-skills` (from provider-file-skills)
- `ext-file-identity` (from provider-file-identity)
- `ext-sqlite-memory` (from provider-sqlite-memory)
- `ext-rules-routing` (from provider-rules-routing)
- `ext-file-tools` (from provider-file-tools)
- `ext-file-tasks` (from provider-file-tasks)
- `ext-file-prompts` (from provider-file-prompts)
- `ext-file-memory` (from provider-file-memory)

Each conversion: implement factory function, register tools + subscribe events, test independently.

### Phase 3: Rewrite runtime
- Remove provider creation from boot
- Boot = load extensions + fire resources_discover + fire session_start
- processPrompt = label_extract + route + context_enrich + assemble + trim
- learn = fire agent_end
- Remove engine.ts, loader.ts, contracts.ts, hooks.ts
- Simplify config.ts to parse settings.json

### Phase 4: `dot-ai` CLI
- Create `@dot-ai/cli` package
- Implement workspace detection, boot with cache, tool execution
- Subcommands auto-generated from tool registry
- `dot-ai cache clear` command

### Phase 5: Update adapters
- Pi adapter: map all events bidirectionally
- Claude Code adapter: Skills-First (auto-generate skills from tool registry, no MCP)
- OpenClaw adapter: use new extension-based runtime
- Sync adapter: use resources_discover + context_enrich for snapshot

### Phase 6: Caching layer
- Implement `.ai/.cache/` boot cache
- Checksum-based invalidation
- Benchmark hook latency before/after

### Phase 7: Config migration
- `.ai/settings.json` format (Pi-compatible)
- Migration tool: read old `dot-ai.yml`, write new `settings.json`
- Update kiwi workspace

### Phase 8: Cleanup and tests
- Delete dead code (contracts, loader, engine, hooks, capabilities, MCP server)
- Update all tests
- E2E validation on kiwi workspace
- Pi conformance tests
- Degradation tests per adapter tier

---

## 16. Open Questions (Resolved)

### Q1: Should dot-ai depend on Pi's extension primitives directly?

**Decision:** Strategy B (independent, structural compatibility). Use same naming conventions, same `settings.json` format, same factory pattern. Extract shared package later when patterns stabilize.

### Q2: Should `label_extract` be an event or stay as core logic?

**Decision:** Core logic with an optional `on('label_extract')` event for advanced cases. Labels are core infrastructure.

### Q3: Token budget trimming — core or extension?

**Decision:** Sections have priority (set by extensions), trimming is core logic. Identity (100) never trimmed, Memory (80) and Skills (60) trimmed last.

### Q4: Config file format?

**Decision:** `.ai/settings.json` (Pi-compatible). Optional — works with pure auto-discovery if absent.

### Q5: How are tools exposed on limited adapters?

**Decision:** Core owns the tool registry. Adapters own the exposure strategy:
- Pi/OpenClaw: native `registerTool`
- Claude Code: auto-generated skill + `dot-ai` CLI via Bash
- Sync: text description in rules file

This is an **adapter concern**, not a core concern. Core never generates skills.

### Q6: Is the `dot-ai` CLI specific to Claude Code?

**Decision:** No. The CLI (`@dot-ai/cli`) is a **global npm package** that works in any workspace for any adapter. It's the universal fallback for tool execution.

### Q7: Extension load order?

**Decision:** `settings.json` declaration order, then auto-discovered alphabetically.
