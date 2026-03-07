# dot-ai v7 Architecture

## What is dot-ai?

dot-ai is a **deterministic context enrichment engine** for AI workspaces. It enriches agent prompts with workspace knowledge (skills, memory, identities, tools, routing rules) using an extension-only architecture. No providers, no contracts — everything is an extension.

Key insight: **The agent is the consumer, dot-ai is the enricher.** Adapters integrate dot-ai into specific agents (Claude Code, OpenClaw, Pi) via native hooks, making enrichment invisible to the agent while giving it complete workspace context.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Agent Environment (Claude Code / OpenClaw / Pi)            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Adapter (adapter-claude / adapter-openclaw / pi)  │     │
│  │  Hooks into native agent events:                   │     │
│  │  - Claude Code: UserPromptSubmit + PreToolUse etc. │     │
│  │  - OpenClaw: before_agent_start hook               │     │
│  │  - Pi: native extension system                     │     │
│  └────────────────────────────────────────────────────┘     │
│                       │                                     │
│                       ▼                                     │
│  ┌────────────────────────────────────────────────────┐     │
│  │  DotAiRuntime (@dot-ai/core)                       │     │
│  │                                                    │     │
│  │  boot()           → discover extensions            │     │
│  │                     register resources              │     │
│  │                     build vocabulary                │     │
│  │                                                    │     │
│  │  processPrompt()  → label_extract (chain-transform)│     │
│  │                     context_enrich (collect-sections│     │
│  │                     route (first-result)            │     │
│  │                     → { sections, labels, routing } │     │
│  │                                                    │     │
│  │  fireToolCall()   → tool_call (until-blocked)      │     │
│  │  fire('agent_end')→ notify extensions              │     │
│  │  shutdown()       → session_end + flush            │     │
│  └────────────────────────────────────────────────────┘     │
│                       │                                     │
│           ┌───────────┼───────────────┬──────────┐          │
│           ▼           ▼               ▼          ▼          │
│     ext-file-     ext-file-     ext-rules-   ext-file-      │
│     identity      memory        routing      skills         │
│     ext-file-     ext-file-     ext-sqlite-  .ai/ext/       │
│     tools         tasks         memory       *.ts           │
│           │           │               │          │          │
│           └───────────┼───────────────┴──────────┘          │
│                       ▼                                     │
│             Adapter formats sections                        │
│             via formatSections() → markdown                 │
│             → injected into agent context                   │
└─────────────────────────────────────────────────────────────┘
```

---

## DotAiRuntime API

`DotAiRuntime` is the single entry point for the full pipeline lifecycle. Adapters instantiate it and call its methods.

```typescript
import { DotAiRuntime } from '@dot-ai/core';

const runtime = new DotAiRuntime({
  workspaceRoot: '/path/to/workspace',
  logger,
  tokenBudget: 8000,
});
```

### boot()

Runs **once per session**. Discovers extensions, registers resources, builds vocabulary.

```typescript
await runtime.boot();
```

What happens:
1. Load config from `.ai/dot-ai.yml`
2. Discover extensions (`.ai/extensions/*.ts` + installed packages)
3. Run extension factories — each calls `registerSkill()`, `registerIdentity()`, `contributeLabels()`, `registerTool()`, `registerCommand()`, and subscribes to events
4. Build vocabulary from all contributed labels
5. Build capabilities from extension-registered tools
6. Fire `session_start` event

Idempotent — safe to call multiple times.

### processPrompt(prompt)

Runs **for each prompt**. Returns structured data (not formatted text).

```typescript
const { sections, labels, routing } = await runtime.processPrompt(prompt);
```

Pipeline steps:
1. **label_extract** — Extract labels from prompt using vocabulary (regex match), then chain-transform through extensions
2. **route** — Fire `route` event, first result wins → `RouteResult | null`
3. **context_enrich** — Fire `context_enrich`, collect sections from all extensions → `Section[]`
4. Add core system section (lists available skills and tools)
5. Sort sections by priority DESC

The adapter then calls `formatSections(sections)` to produce markdown.

### fireToolCall(event)

Gate tool calls through extensions. Returns a block result if any extension blocks.

```typescript
const result = await runtime.fireToolCall({ tool: 'Write', input: { file_path: '.env' } });
if (result?.decision === 'block') {
  // Tool call was blocked by an extension
}
```

### fire(event, data)

Fire any event to notify extensions. Used by adapters for agent lifecycle events.

```typescript
await runtime.fire('agent_end', { response });
await runtime.fire('turn_start');
await runtime.fire('session_compact');
```

### shutdown()

Fires `session_end` and flushes the logger.

```typescript
await runtime.shutdown();
```

---

## Extension API

Extensions are factory functions that receive an `ExtensionAPI` object. They register resources and subscribe to events.

```typescript
import type { ExtensionAPI } from '@dot-ai/core';

export default function(api: ExtensionAPI) {
  // Register resources
  api.registerSkill({ name: 'my-skill', description: '...', labels: ['my-label'] });
  api.registerIdentity({ type: 'agents', content: '...', priority: 100, source: 'my-ext' });
  api.contributeLabels(['custom-label-1', 'custom-label-2']);
  api.registerTool({ name: 'my_tool', description: '...', parameters: {}, execute: async (input) => ({ content: '...' }) });
  api.registerCommand({ name: 'my-cmd', description: '...', execute: async (args) => ({ output: '...' }) });

  // Subscribe to events
  api.on('context_enrich', async (event, ctx) => {
    return { sections: [{ title: 'My Section', content: '...', priority: 50, source: 'my-ext' }] };
  });

  api.on('tool_call', async (event, ctx) => {
    if (event.tool === 'dangerous_tool') return { decision: 'block', reason: 'Not allowed' };
  });

  api.on('agent_end', async (event, ctx) => {
    // Store learnings, update state, etc.
  });

  // Inter-extension communication
  api.events.on('custom-event', (data) => { /* ... */ });
  api.events.emit('custom-event', { key: 'value' });
}
```

### Resource Registration

| Method | Purpose | Effect |
|--------|---------|--------|
| `registerSkill(skill)` | Register a skill for discovery | Added to vocabulary, listed in system section |
| `registerIdentity(identity)` | Register identity document | Available to other extensions via context |
| `contributeLabels(labels)` | Add labels to vocabulary | Used for deterministic prompt matching |
| `registerTool(tool)` | Register an interactive tool | Exposed as native agent capability |
| `registerCommand(cmd)` | Register a slash command | Available to adapters that support commands |

---

## Section-Based Formatting

v7 uses `Section` objects as the atomic output unit. Extensions return sections via `context_enrich`; the formatter assembles them into markdown.

### Section Interface

```typescript
interface Section {
  id?: string;           // Unique ID (same-id sections are overridden, last-wins)
  title: string;         // Section heading
  content: string;       // Markdown content
  priority: number;      // Ordering and trim precedence (higher = more important)
  source: string;        // Which extension produced this
  trimStrategy?: 'never' | 'truncate' | 'drop';  // Budget trimming behavior
}
```

Priority conventions: 100 = identity, 95 = system, 80 = memory, 60 = skills, 50 = tasks, 40 = tools, 30 = routing.

### Formatting Utilities

```typescript
import { formatSections, assembleSections, trimSections } from '@dot-ai/core';

// Format with optional token budget
const markdown = formatSections(sections, { tokenBudget: 8000 });

// Or manually:
const sorted = sections.sort((a, b) => b.priority - a.priority);
const trimmed = trimSections(sorted, 8000);
const output = assembleSections(trimmed);
```

**`formatSections(sections, options?)`** — Sort by priority, optionally trim to budget, assemble to markdown.

**`assembleSections(sections)`** — Join sections as `## Title\n\ncontent` separated by `---`.

**`trimSections(sections, budget)`** — Apply trim strategies: first truncate `'truncate'` sections to 2000 chars, then drop `'drop'` sections (lowest priority first). `'never'` sections are never removed.

---

## 5 Emission Patterns

The `ExtensionRunner` fires events using five distinct patterns:

| Pattern | Method | Use Case | Behavior |
|---------|--------|----------|----------|
| **fire** | `fire(event, data, ctx)` | Lifecycle events (`session_start`, `agent_end`) | All handlers run, results collected |
| **fireCollectSections** | `fireCollectSections(event, data, ctx)` | `context_enrich` | All handlers run, sections merged (same-id = last-wins) |
| **fireFirstResult** | `fireFirstResult(event, data, ctx)` | `route` | Stops at first non-null result |
| **fireChainTransform** | `fireChainTransform(event, data, ctx)` | `label_extract`, `input`, `tool_result` | Each handler receives previous handler's output |
| **fireUntilBlocked** | `fireUntilBlocked(event, data, ctx)` | `tool_call` | Stops at first `{ decision: 'block' }` result |

All patterns catch errors per-handler and log them — a failing handler never blocks the pipeline.

---

## Packages Overview

| Package | Location | Purpose |
|---------|----------|---------|
| **core** | `packages/core/` | Runtime, extension runner, section formatting, labels, boot cache |
| **adapter-claude** | `packages/adapter-claude/` | Claude Code integration (hooks + MCP server) |
| **adapter-openclaw** | `packages/adapter-openclaw/` | OpenClaw integration |
| **adapter-pi** | `packages/adapter-pi/` | Pi adapter (full event support) |
| **adapter-sync** | `packages/adapter-sync/` | Cursor / Copilot / Windsurf sync |
| **ext-file-identity** | `packages/ext-file-identity/` | Loads identity files (AGENTS.md, SOUL.md, etc.) |
| **ext-file-memory** | `packages/ext-file-memory/` | File-based memory (searches `.ai/memory/*.md`) |
| **ext-file-skills** | `packages/ext-file-skills/` | File-based skills (`.ai/skills/*/SKILL.md`) |
| **ext-file-tools** | `packages/ext-file-tools/` | File-based tools (`.ai/TOOLS.md`) |
| **ext-file-tasks** | `packages/ext-file-tasks/` | File-based tasks (`.ai/memory/tasks/*.md`) |
| **ext-file-prompts** | `packages/ext-file-prompts/` | File-based prompt templates |
| **ext-rules-routing** | `packages/ext-rules-routing/` | Rules-based model routing |
| **ext-sqlite-memory** | `packages/ext-sqlite-memory/` | SQLite memory with FTS5 |
| **cli** | `packages/cli/` | CLI commands (init, scan, doctor, audit) |

---

## Adapters

Adapters bridge agents and dot-ai. Each adapter uses `DotAiRuntime` internally and maps to the agent's native event system.

### adapter-claude

**Hooks:** Multi-hook dispatch — `UserPromptSubmit`, `PreCompact`, `Stop`, `PreToolUse` (native Claude Code hooks).

**Flow:**
1. Hook receives event JSON on stdin
2. `DotAiRuntime.boot()` (cached) → `processPrompt(prompt)`
3. `formatSections(sections)` → markdown
4. Output JSON `{ result: markdown }` to stdout
5. Claude Code injects into context

**MCP Server:** `dot-ai-mcp` binary exposes extension-registered tools as MCP tools.

### adapter-openclaw

**Hook:** `before_agent_start` (native OpenClaw hook).

**Flow:**
1. `DotAiRuntime` created with workspace config
2. `runtime.boot()` (cached per workspace)
3. `runtime.processPrompt(prompt)` → `formatSections()` → `prependContext`
4. Extension-registered tools registered as native OpenClaw tools via `api.registerTool()`

### adapter-pi

**Integration:** Native Pi extension system with full event support.

**Capabilities:** All events supported — `context_enrich`, `tool_call`, `tool_result`, `agent_end`, `input`, full lifecycle.

### adapter-sync

**Purpose:** Generate static context files for agents without plugin support.

**Targets:** Windsurf (`.windsurf/rules/`), Cursor (`.cursor/rules/`), Codex (`AGENTS.md`).

---

## Key Design Decisions

### 1. Extension-Only Architecture (v7)

v7 removes the provider contract system entirely. Everything is an extension:

- **Before (v4-v5):** 6 provider contracts (Memory, Skills, Identity, Routing, Tasks, Tools) + extensions for hooks
- **After (v7):** Extensions register resources (`registerSkill`, `registerIdentity`, `contributeLabels`) and subscribe to events (`context_enrich`, `route`, `tool_call`)

**Why?** Extensions are more composable than contracts. An extension can register a skill AND listen to `agent_end` AND contribute labels — all in one place. Provider contracts forced artificial separation.

### 2. Deterministic Labels

Label extraction is **deterministic** — pure regex substring matching against a vocabulary built at boot.

- Same prompt always produces same labels
- No LLM cost in the pipeline
- No hallucination — vocabulary is explicitly defined by extensions
- Predictable routing — rules match against known labels

### 3. Boot Caching

Extensions are discovered and loaded once per session. Vocabulary, skills, identities, and tools are built at boot and reused for every prompt.

- Speeds up per-prompt enrichment (no disk I/O)
- Reduces memory churn (reuse cached data)
- Simplifies reasoning (agent sees consistent skill set)

### 4. Section-Based Output

`processPrompt()` returns `Section[]` instead of a formatted string. This gives adapters control over formatting:

- Adapters can filter, reorder, or merge sections
- Token budget trimming is section-aware (respects `trimStrategy`)
- Same sections, different formats per adapter

### 5. 5 Emission Patterns

Events need different semantics. A single "fire and collect" pattern does not cover routing (first-result), label enrichment (chain-transform), or tool gating (until-blocked). Five patterns cover all use cases cleanly.

### 6. Lazy-Load Skill Content

Skills are listed at boot (metadata only), but content is loaded on-demand during `context_enrich`. Only matched skill docs appear in context.

---

## Event Reference

| Event | Pattern | When | Handler Signature |
|-------|---------|------|-------------------|
| `label_extract` | chainTransform | After core label extraction | `(labels: Label[], ctx) => Label[] \| void` |
| `context_enrich` | collectSections | Per prompt, after labels | `(event: { prompt, labels }, ctx) => { sections? } \| void` |
| `route` | firstResult | Per prompt, after labels | `(event: { labels }, ctx) => RouteResult \| void` |
| `input` | chainTransform | Before prompt processing (Pi) | `(event: { input }, ctx) => InputResult \| void` |
| `tool_call` | untilBlocked | Before tool execution | `(event: { tool, input }, ctx) => { decision, reason } \| void` |
| `tool_result` | chainTransform | After tool execution | `(event: { tool, result, isError }, ctx) => void` |
| `agent_end` | fire | After agent response | `(event: { response }, ctx) => void` |
| `session_start` | fire | At boot | `(undefined, ctx) => void` |
| `session_end` | fire | At shutdown | `(undefined, ctx) => void` |
| `session_compact` | fire | On context compaction | `(undefined, ctx) => void` |
| `agent_start` | fire | Before agent loop | `(undefined, ctx) => void` |
| `turn_start` | fire | Before each turn | `(undefined, ctx) => void` |
| `turn_end` | fire | After each turn | `(undefined, ctx) => void` |

---

## Type Flow

```
Input: string (raw prompt)
  ↓
[runtime.boot()] → discover extensions, register resources, build vocabulary
                   → fire session_start
  ↓
[runtime.processPrompt(prompt)]
  ├─ extractLabels(prompt, vocabulary) → Label[]
  ├─ fireChainTransform('label_extract', labels) → enriched Label[]
  ├─ fireFirstResult('route', { labels }) → RouteResult | null
  ├─ fireCollectSections('context_enrich', { prompt, labels }) → Section[]
  ├─ add core system section
  ├─ sort sections by priority DESC
  └─ return { sections, labels, routing }
  ↓
[Adapter formatting]
  ├─ formatSections(sections, { tokenBudget }) → string (markdown)
  └─ inject into agent context
  ↓
[runtime.fire('agent_end', { response })] → extensions notified
```

---

## Summary

dot-ai v7 is an **extension-based context enrichment engine**:

1. **Extensions** are the only mechanism — no provider contracts
2. **DotAiRuntime** encapsulates the full pipeline lifecycle
3. **Sections** are the atomic output unit, assembled by priority
4. **Labels** enable deterministic matching without LLM calls
5. **5 emission patterns** cover all event semantics
6. **Boot caching** optimizes per-prompt performance
7. **Adapters** integrate into specific agents via native hooks
8. **Token budget** trims sections respecting trim strategies
9. **Determinism** ensures reproducible context

Result: **Agents get complete, consistent workspace context through a unified extension system.**
