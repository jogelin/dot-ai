# @dot-ai/adapter-openclaw

OpenClaw adapter for dot-ai — universal context enrichment across AI agents.

## Why dot-ai exists

AI agents (OpenClaw, Claude Code, Cursor, etc.) each implement their own memory, skills, and context systems. They're all solving the same problem differently, with hardcoded backends and no portability.

**dot-ai generalizes this.** One configuration (`dot-ai.yml`), pluggable providers, multiple adapters. Switch your memory backend without touching agent config. Use the same memory across OpenClaw and Claude Code.

## Comparison: How agents handle memory

### OpenClaw (built-in `memory-core`)

```
memory-core plugin
├── Tools: memory_search, memory_get (hardcoded)
├── Backend: markdown files (MEMORY.md + memory/*.md)
├── System prompt: buildMemorySection() — hardcoded text
│   "run memory_search on MEMORY.md + memory/*.md"
└── Search: line-by-line keyword matching
```

- Storage and search logic baked into the plugin
- System prompt describes file-based memory regardless of actual backend
- No way to swap to SQLite, vector DB, or API without replacing the entire plugin
- `kind: "memory"` slot system allows replacement (one plugin per kind)

### Claude Code (native auto-memory)

```
Auto-memory system
├── Storage: ~/.claude/projects/<project>/memory/MEMORY.md
├── Write: Claude uses Write/Edit tools on markdown files
├── Read: First 200 lines of MEMORY.md injected at session start
├── Search: Claude reads files with Read tool (no semantic search)
└── Control: autoMemoryEnabled: true/false (global toggle)
```

- Plain markdown files, no indexing or search
- Hardcoded directory structure per project
- No plugin API to redirect memory writes
- Hooks available: UserPromptSubmit (inject), PreCompact (save before compaction), Stop (extract learnings)
- Can disable native memory and replace via hooks + MCP tools

### dot-ai (provider-based)

```
dot-ai.yml (user config)
│
├── MemoryProvider interface
│   ├── search(query, labels) → MemoryEntry[]
│   ├── store(entry) → void
│   └── describe() → string  ← tells the LLM what system is active
│
├── Providers (interchangeable)
│   ├── @dot-ai/provider-file-memory    → markdown files
│   ├── @dot-ai/provider-sqlite-memory  → SQLite + FTS5
│   └── (future: vector DB, API, etc.)
│
└── Adapters (multi-agent)
    ├── @dot-ai/adapter-openclaw → before_agent_start + memory slot
    └── @dot-ai/adapter-claude   → UserPromptSubmit hook
```

- **One config** (`dot-ai.yml`) controls the backend for all agents
- **Provider swap** = one line change, no code modification
- **Self-describing** = `describe()` tells the LLM exactly what system is active
- **Same memory** shared across OpenClaw and Claude Code sessions

## Key difference: describe()

The core innovation is that each provider **tells the LLM how memory works**:

| Provider | describe() output |
|----------|------------------|
| `file-memory` | "File-based memory (markdown files). Directories: root:memory/." |
| `sqlite-memory` | "SQLite memory with FTS5 full-text search. 1626 entries indexed." |

This is injected as a blockquote in the memory section:

```markdown
## Relevant Memory

> SQLite memory with FTS5 full-text search. 1626 entries indexed. Memories are stored and searched automatically.

- Previous decision about API design (2026-03-04)
- User prefers TypeScript over JavaScript (2026-03-01)
```

No more "run memory_search on MEMORY.md" when the backend is SQLite.

## OpenClaw integration

### Memory slot replacement

This plugin declares `kind: "memory"` to replace OpenClaw's built-in `memory-core` via the exclusive slot system.

**What gets replaced:**

| Component | memory-core | dot-ai |
|-----------|-------------|--------|
| Tools | `memory_search`, `memory_get` | `memory_recall`, `memory_store` |
| System prompt | Hardcoded `buildMemorySection()` | Dynamic via `describe()` + `prependContext` |
| Backend | Markdown files only | Any provider (SQLite, files, API...) |
| Search | Line-by-line keyword | Provider-dependent (FTS5, keyword, vector...) |

**How it works:**

1. `openclaw.plugin.json` declares `kind: "memory"` → enters slot competition
2. User sets `plugins.slots.memory: "dot-ai"` → OpenClaw disables `memory-core`
3. `buildMemorySection()` returns `[]` (our tools aren't named `memory_search`/`memory_get`)
4. dot-ai injects its own context via `before_agent_start` → `prependContext`

**User configuration:**

```yaml
# ~/.openclaw/openclaw.yaml (or .json)
plugins:
  slots:
    memory: "dot-ai"
```

### Context enrichment (beyond memory)

Independent of the slot system, the plugin hooks `before_agent_start` to run the full dot-ai pipeline:

```
loadConfig → createProviders → boot → enrich → formatContext → prependContext
```

This injects **all** dot-ai context: identities, skills, tools, routing, and memory. The slot only controls which memory tools are active — the rest flows through `prependContext` regardless.

## Claude Code integration

See `@dot-ai/adapter-claude` for the Claude Code adapter.

**Current capabilities:**

| Hook | Purpose | Status |
|------|---------|--------|
| `UserPromptSubmit` | Inject enriched context | Implemented |
| `PreCompact` | Save to memory before compaction | Planned |
| `Stop` | Extract learnings after response | Planned |
| MCP server | `memory_recall`/`memory_store` tools | Planned |
| `autoMemoryEnabled: false` | Disable native MEMORY.md | Planned |
| `PreToolUse` (Write/Edit) | Intercept native memory writes | Planned |

**Target architecture:**

```
Claude Code session
├── SessionStart: boot dot-ai providers
├── UserPromptSubmit: enrich() → inject context (done)
├── PreCompact: parse transcript → provider.store() (planned)
├── Stop: extract learnings → provider.store() (planned)
├── MCP tools: memory_recall, memory_store (planned)
└── PreToolUse: intercept writes to ~/.claude/*/memory/ (planned)
```

## OpenClaw slot system — future tracking

As of March 2026, OpenClaw only supports one slot kind: `"memory"`. The architecture is extensible:

```typescript
// openclaw/src/plugins/types.ts
export type PluginKind = "memory";  // only value today

// openclaw/src/plugins/slots.ts
const SLOT_BY_KIND = { memory: "memory" };  // extensible map
```

dot-ai already has providers for capabilities that could become future slot kinds:

| Potential Kind | dot-ai Provider | OpenClaw Status |
|---------------|-----------------|-----------------|
| `memory` | MemoryProvider | **Supported** (slot exists) |
| `skills` | SkillProvider | Not yet — dot-ai uses `prependContext` |
| `routing` | RoutingProvider | Not yet — dot-ai uses `prependContext` |
| `identity` | IdentityProvider | Not yet — dot-ai uses `prependContext` |
| `tools` | ToolProvider | Not yet — dot-ai uses `prependContext` |

When OpenClaw adds new kinds, this adapter can declare them for native slot integration.

## Architecture

```
dot-ai.yml
    │
    ▼
@dot-ai/core ─── contracts (6 interfaces) + engine (boot/enrich/learn)
    │
    ├── Providers (pluggable backends)
    │   ├── file-memory, sqlite-memory
    │   ├── file-skills, file-identity, file-tools
    │   ├── rules-routing
    │   └── cockpit-tasks (kiwi-specific)
    │
    └── Adapters (agent integration)
        ├── adapter-openclaw (this) ── slot + before_agent_start
        ├── adapter-claude ────────── UserPromptSubmit hook
        └── adapter-sync ──────────── file markers for Cursor/Copilot
```

The key insight: **agents are just adapters**. The intelligence lives in the providers and engine. Adding support for a new agent means writing one adapter file, not reimplementing memory/skills/routing.
