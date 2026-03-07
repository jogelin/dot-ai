# dot-ai v7 — Event-Driven Lifecycle Plan

## 1. Design Principles

- **Everything is an event.** The lifecycle is a list of normalized events.
- **Adapters are bidirectional translators.** Agent events → dot-ai events → structured results → adapter applies to agent.
- **Structured data, not markdown.** Core returns typed objects. Adapters decide presentation.
- **Extensions are pure event subscribers.** They don't know which agent runs them.
- **Priority: native API > conventions > prompt injection.** Use the agent's built-in systems first.
- **No backward compat.** Clean break from v5/v6.

---

## 2. Normalized Lifecycle Events

### 2.1 Session Level

| Event | Firing | Data In | Data Out |
|-------|--------|---------|----------|
| `session_start` | Once after boot | `{ sessionId, resuming }` | — |
| `session_end` | Before shutdown | `{ reason }` | — |
| `session_compact` | Before compaction | `{ tokenCount, maxTokens }` | `{ summary? }` |

### 2.2 Agent Loop Level

| Event | Firing | Data In | Data Out |
|-------|--------|---------|----------|
| `agent_start` | After user submits, before LLM | `{ prompt, sessionId }` | — |
| `context_enrich` | Per prompt, collect sections | `{ prompt, labels }` | `{ sections[], systemPrompt? }` |
| `agent_end` | After full response | `{ response, toolsUsed[] }` | — |

### 2.3 Turn Level (multi-turn agent loops)

| Event | Firing | Data In | Data Out |
|-------|--------|---------|----------|
| `turn_start` | Before each LLM call | `{ turnIndex, messages[] }` | `{ messages[]? }` |
| `turn_end` | After LLM response | `{ turnIndex, response }` | — |

Useful for: LLM-based routing (call LLM to decide model), LLM-based label extraction, message history modification. Only Pi supports this natively.

### 2.4 Tool Level

| Event | Firing | Data In | Data Out |
|-------|--------|---------|----------|
| `tool_call` | Before tool execution | `{ tool, input }` | `{ decision: 'allow'|'block', reason? }` |
| `tool_result` | After tool execution | `{ tool, result, isError }` | `{ result? }` (chain-transform) |

### 2.5 Input Level

| Event | Firing | Data In | Data Out |
|-------|--------|---------|----------|
| `input` | Raw user input before processing | `{ input }` | `{ input?, consumed? }` (chain-transform) |

Useful for: intercepting commands (`/remember X`), skipping full pipeline for simple commands.

### 2.6 Per-Prompt Pipeline

| Event | Firing | Data In | Data Out |
|-------|--------|---------|----------|
| `label_extract` | Per prompt | `{ prompt, vocabulary, labels }` | `labels[]` (chain-transform) |
| `route` | Per prompt, after labels | `{ labels }` | `{ model, reason }` (first-result) |

---

## 3. Registration API (Boot)

Extensions register resources during boot via explicit methods:

```typescript
api.registerTool({ name, description, parameters, execute, promptSnippet?, promptGuidelines? });
api.registerSkill({ name, description, content, labels, triggers });
api.registerIdentity({ name, content, priority });
api.registerCommand({ name, description, parameters, execute });
```

**The core maintains a typed registry** accessible after boot:

```typescript
runtime.tools       // ToolDefinition[]
runtime.skills      // SkillDefinition[]
runtime.identities  // IdentityDefinition[]
runtime.commands    // CommandDefinition[]
```

No `resources_discover` event. Registration IS discovery. The sync happens once after boot when all extensions have registered.

---

## 4. Agent Capability Matrix

| Capability | Pi | OpenClaw | Claude Code | Cursor |
|---|---|---|---|---|
| **Session lifecycle** | Full | Partial (bootstrap, compact) | Full (hooks) | None |
| **Per-prompt hook** | `before_agent_start` | `before_agent_start` | `UserPromptSubmit` | None |
| **Post-response** | `agent_end` | `after_agent_end` | `Stop` | None |
| **Turn-level** | `turn_start/end`, `context` | No | No | No |
| **Tool interception** | `tool_call` + `tool_result` | No | `PreToolUse` + `PostToolUse` | No |
| **Input interception** | `input` (consumable) | `message:received` | `UserPromptSubmit` | No |
| **Native tool API** | `pi.registerTool()` | `api.registerTool()` | MCP servers | MCP servers |
| **Native skill convention** | Extensions natives | No (bootstrap files only) | `.claude/skills/` | No |
| **Native identity convention** | System prompt | `AGENTS.md` via bootstrap hook | `.claude/rules/` | `.cursor/rules/` or `.cursorrules` |
| **Compaction** | `session_before_compact` | `session:compact:before` | `PreCompact` | No |

---

## 5. Adapter Strategy

### Priority Order

Each adapter applies resources using the **best available mechanism**, in order:

1. **Native API** — `registerTool()`, MCP server, etc.
2. **File conventions** — `.claude/skills/`, `.claude/rules/`, bootstrap files, `.cursorrules`
3. **Prompt injection** — inject in context as last resort

### 5.1 Adapter as Plugin/Extension

**Critical:** The adapter lives INSIDE the agent's plugin/extension system. It does NOT pollute the user's repo.

| Agent | Adapter Form | Where Files Go |
|---|---|---|
| Pi | Pi extension | Pi extension directory |
| OpenClaw | OpenClaw plugin | Plugin directory + workspace bootstrap paths |
| Claude Code | Claude Code plugin | Plugin directory (`.claude-plugin/`) |
| Cursor | Cursor extension / .cursorrules generator | Extension directory |

### 5.2 Claude Code Adapter (Plugin)

**Form:** Claude Code plugin with hooks, MCP server, skills, and rules.

```
dot-ai-plugin/
  .claude-plugin/
    plugin.json                 # Plugin manifest
  hooks/
    hooks.json                  # Hook config (SessionStart, UserPromptSubmit, Stop, etc.)
  scripts/
    on-session-start.sh         # → runtime.fire('session_start')
    on-prompt.sh                # → runtime.fire('context_enrich') → return context
    on-stop.sh                  # → runtime.fire('agent_end')
  skills/                       # Synced from runtime.skills (symlinks to .ai/skills/)
    deploy/SKILL.md             # → symlink to .ai/skills/deploy/SKILL.md
    security/SKILL.md           # → symlink to .ai/skills/security/SKILL.md
  agents/                       # dot-ai specific agents if needed
  .mcp.json                     # MCP server exposing runtime.tools
  settings.json                 # Plugin default settings
```

**What uses what:**

| Resource | Mechanism | Priority |
|---|---|---|
| Tools (memory_recall, task_list...) | MCP server (native API) | 1 |
| Skills | `.claude/skills/` via plugin `skills/` dir (convention) | 2 |
| Identities | `.claude/rules/` — plugin can't write there, so `SessionStart` hook injects as `additionalContext` | 3 |
| Dynamic content (memory, tasks) | `UserPromptSubmit` hook → inject as context | 3 |
| Tool events (tool_call/result) | `PreToolUse`/`PostToolUse` hooks matching `mcp__dot-ai__.*` | 1 |

**hooks.json inside the plugin:**

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/scripts/on-session-start.sh"
      }]
    }],
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/scripts/on-prompt.sh"
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/scripts/on-stop.sh"
      }]
    }],
    "PreToolUse": [{
      "matcher": "mcp__dot-ai__.*",
      "hooks": [{
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/scripts/on-pre-tool.sh"
      }]
    }],
    "PostToolUse": [{
      "matcher": "mcp__dot-ai__.*",
      "hooks": [{
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/scripts/on-post-tool.sh"
      }]
    }],
    "PreCompact": [{
      "hooks": [{
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/scripts/on-compact.sh"
      }]
    }],
    "SessionEnd": [{
      "hooks": [{
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/scripts/on-session-end.sh"
      }]
    }]
  }
}
```

**Skill sync:** At boot (SessionStart), the plugin syncs `runtime.skills` as symlinks inside its own `skills/` directory. Claude Code discovers them natively as plugin skills.

**Identity sync:** Claude Code plugins can't write to `.claude/rules/`. Instead, the `SessionStart` hook returns `additionalContext` with identity content. Or identities are referenced from `settings.json` as plugin-level rules if the API supports it.

### 5.3 OpenClaw Adapter (Plugin)

**Form:** OpenClaw plugin.

| Resource | Mechanism | Priority |
|---|---|---|
| Tools | `api.registerTool()` (native API) | 1 |
| Identities | `agent:bootstrap` hook → inject `AGENTS.md` path (convention) | 2 |
| Skills | `before_agent_start` → inject in `prependContext` (prompt injection) | 3 |
| Dynamic content | `before_agent_start` → inject in `prependContext` (prompt injection) | 3 |

OpenClaw has no native skill convention. Skills content goes in `prependContext`. But for identities, the adapter configures the `bootstrap-extra-files` hook to point to `.ai/AGENTS.md`, `.ai/SOUL.md` etc. — these are real files in the workspace, loaded natively.

### 5.4 Pi Adapter (Extension)

**Form:** Pi extension (native — most granular).

| Resource | Mechanism | Priority |
|---|---|---|
| Tools | `pi.registerTool()` (native API) | 1 |
| Skills | Pi native extension/skill system (native API) | 1 |
| Identities | System prompt fragments via `before_agent_start` (native API) | 1 |
| Dynamic content | `context` event → message injection (native API) | 1 |
| Everything | 1:1 event mapping | — |

Pi supports everything natively. No conventions or prompt injection needed.

### 5.5 Cursor Adapter

**Form:** Static file generator.

| Resource | Mechanism | Priority |
|---|---|---|
| Identities | `.cursor/rules/` or `.cursorrules` (convention) | 2 |
| Skills | Included in rules files (convention) | 2 |
| Tools | MCP server if supported, otherwise in rules (convention/prompt) | 1-2 |
| Dynamic content | Not supported (static only) | — |

### 5.6 Generated Files Policy

Files generated by adapters into the workspace (not inside plugin dirs):
- **Tagged:** `<!-- generated by dot-ai — edits will be overwritten on next sync -->`
- **Committed:** Files are meant to be pushed (NOT gitignored)
- **Idempotent:** Re-running sync produces the same output

---

## 6. Adapter Event Mapping

### 6.1 Pi (Full — 1:1)

```
Pi Event                     → dot-ai Event
─────────────────────────────────────────────────
session_start                → session_start
session_shutdown             → session_end
session_before_compact       → session_compact
before_agent_start           → agent_start + context_enrich
agent_end                    → agent_end
turn_start                   → turn_start
turn_end                     → turn_end
context                      → (message modification in turn)
tool_call                    → tool_call
tool_result                  → tool_result
input                        → input
model_select                 → route
```

### 6.2 OpenClaw (Standard — batched)

```
OpenClaw Event               → dot-ai Events
─────────────────────────────────────────────────
gateway:startup              → boot() → session_start
before_agent_start           → label_extract + route + context_enrich → { prependContext }
after_agent_end              → agent_end
session:compact:before       → session_compact
(process exit)               → session_end
```

### 6.3 Claude Code (Standard — hooks)

```
Claude Code Hook             → dot-ai Events
─────────────────────────────────────────────────
SessionStart                 → boot() → session_start
UserPromptSubmit             → label_extract + route + context_enrich → additionalContext
Stop                         → agent_end
PreToolUse (mcp__dot-ai__)   → tool_call
PostToolUse (mcp__dot-ai__)  → tool_result
PreCompact                   → session_compact
SessionEnd                   → session_end
```

### 6.4 Cursor (Minimal — static)

```
(CLI: dot-ai sync)           → boot() → generate files
```

No runtime events. Single-shot.

---

## 7. Context Enrichment Strategy

### What Core Returns (structured)

`processPrompt()` returns:

```typescript
interface ProcessResult {
  sections: Section[];         // from context_enrich
  labels: Label[];             // from label_extract
  routing: RouteResult | null; // from route
}
```

No markdown assembly in core. Adapter decides format.

### What Extensions Return in context_enrich

| Extension | Section Content | Priority |
|---|---|---|
| Core | "dot-ai active. Skills: deploy, security. Tools: memory_recall, memory_store, task_list." | 95 |
| ext-sqlite-memory | "Memory: SQLite (42 entries)." + matched memories or "No relevant memories." | 80 |
| ext-file-skills | **Hint only** if skill synced to convention: "The 'deploy' skill is relevant for this prompt." **Full content** if no convention (DB source, OpenClaw): full skill markdown | 60 |
| ext-file-tasks | Active tasks list | 40 |
| ext-file-identity | *(NOT in context_enrich if synced to convention — already loaded by agent natively)* | — |

### Key Rule: Reference vs Content

If the adapter has synced a resource to the agent's native convention → extension returns a **hint/reference** in context_enrich (lightweight).

If not synced (no convention, DB source) → extension returns **full content** in context_enrich.

The extension needs to know which mode to use. This is configured via `api.config`:

```typescript
// Extension checks if adapter synced skills natively
const skillsSynced = api.config.skillsSynced ?? false;

api.on('context_enrich', async (event) => {
  const matched = matchSkills(event.labels);
  if (skillsSynced) {
    // Adapter handles skill files — just hint
    return { sections: [{ content: `Relevant skills: ${matched.map(s => s.name).join(', ')}`, priority: 60 }] };
  } else {
    // No native convention — inject full content
    return { sections: matched.map(s => ({ content: s.content, priority: 60 })) };
  }
});
```

---

## 8. Tool Execution

### Flow

```
Agent calls tool → Agent's native mechanism → Adapter → runtime.executeTool(name, params) → Extension handler → Result → Adapter formats → Agent
```

### Per Adapter

| Adapter | How Agent Calls Tool | How Adapter Routes |
|---|---|---|
| Pi | Native tool call | Direct: `pi.registerTool()` wraps `runtime.executeTool()` |
| OpenClaw | Native tool call | Direct: `api.registerTool()` wraps `runtime.executeTool()` |
| Claude Code | MCP tool call (`mcp__dot-ai__memory_recall`) | MCP server wraps `runtime.executeTool()` |
| Cursor | MCP tool call (if supported) | MCP server wraps `runtime.executeTool()` |

### CLI for Edge Cases Only

The `dot-ai` CLI is a fallback for tools that can't be exposed via native APIs:

```bash
dot-ai tool exec memory_recall --query "auth tokens"
```

Not the primary mechanism. MCP/native API first.

---

## 9. Core Runtime Changes

### 9.1 processPrompt() → Structured Return

Remove `assembleSections()` and `trimSections()` from runtime. Move to optional `format()` utility.

```typescript
// Before (v6)
const { formatted, enriched } = await runtime.processPrompt(prompt);

// After (v7)
const { sections, labels, routing } = await runtime.processPrompt(prompt);
// Adapter formats as needed
const formatted = formatSections(sections); // optional utility
```

### 9.2 Remove learn() → fire('agent_end')

```typescript
// Before
await runtime.learn(response);

// After
await runtime.fire('agent_end', { response, toolsUsed: [] });
```

### 9.3 Add Registration Methods

```typescript
api.registerSkill({ name, description, content, labels, triggers });
api.registerIdentity({ name, content, priority });
// registerTool and registerCommand already exist
```

### 9.4 Add executeTool()

```typescript
runtime.executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult>
```

### 9.5 Remove Legacy

- Delete `context_inject`, `context_modify` events and types
- Delete `ADAPTER_CAPABILITIES`, `TOOL_STRATEGY`, `EVENT_TIERS` (adapter concern)
- Delete `resources_discover` event (replaced by registration)
- Delete `assembleSections()`, `trimSections()` from runtime (→ `format.ts` utility)

### 9.6 Core System Section

Core itself registers a system section in `context_enrich`:

```typescript
// In runtime, after boot
this.on('context_enrich', () => ({
  sections: [{
    id: 'dot-ai:system',
    title: 'dot-ai',
    content: `dot-ai workspace active. Skills: ${this.skills.map(s=>s.name).join(', ')}. Tools: ${this.tools.map(t=>t.name).join(', ')}.`,
    priority: 95,
    source: 'core',
    trimStrategy: 'never',
  }]
}));
```

Extensions add their own descriptions:
```
ext-sqlite-memory: "Memory system: SQLite with FTS5 (42 entries). Use memory_recall to search."
ext-file-tasks: "Task tracking active. 3 pending tasks."
```

---

## 10. Extension Event Subscriptions

| Extension | context_enrich | route | agent_end | session_end | label_extract |
|---|:-:|:-:|:-:|:-:|:-:|
| **core** (system section) | x | | | | |
| ext-file-identity | x (if not synced) | | | | |
| ext-file-skills | x (hint or content) | | | | |
| ext-file-tools | x | | | | |
| ext-file-prompts | | | | | |
| ext-file-memory | x | | x | | |
| ext-sqlite-memory | x | | x | x | |
| ext-file-tasks | x | | | | |
| ext-rules-routing | | x | | | |

### Registration at Boot

| Extension | registerTool | registerSkill | registerIdentity | registerCommand |
|---|:-:|:-:|:-:|:-:|
| ext-file-identity | | | x | |
| ext-file-skills | | x | | |
| ext-file-prompts | | | | x |
| ext-file-memory | x (memory_recall, memory_store) | | | |
| ext-sqlite-memory | x (memory_recall, memory_store) | | | |
| ext-file-tasks | x (task_list, task_create, task_update) | | | |

---

## 11. Implementation Plan

### Phase 1: Core Cleanup
1. Remove all v5 legacy types and events
2. Extract `assembleSections()` / `trimSections()` to `format.ts` utility
3. Change `processPrompt()` to return structured data only
4. Remove `learn()` — adapters use `fire('agent_end')`
5. Remove `ADAPTER_CAPABILITIES`, `TOOL_STRATEGY`, `EVENT_TIERS`
6. Remove `resources_discover` event

### Phase 2: Registration & Execution
1. Add `api.registerSkill()`, `api.registerIdentity()`
2. Add `runtime.executeTool()`
3. Add typed registry accessors (`runtime.skills`, `runtime.identities`)
4. Core registers its own system section in `context_enrich`
5. Extensions add their system descriptions

### Phase 3: Extension Updates
1. ext-file-identity: use `registerIdentity()` at boot
2. ext-file-skills: use `registerSkill()` at boot, `context_enrich` for hints/content
3. ext-file-tools: use registration if needed
4. ext-*-memory: add system description in `context_enrich`
5. Add `skillsSynced` config support to ext-file-skills

### Phase 4: Adapter Updates
1. **OpenClaw adapter:** update to use `fire()`, `executeTool()`, bootstrap conventions
2. **Claude Code adapter:** new — implement as plugin (hooks + MCP + skills sync)
3. **Cursor adapter:** new — static file generator
4. **Sync adapter:** simplify to `boot()` + `processPrompt()` + `format()`

### Phase 5: Testing & Observability
1. Unit tests per event (fire, collect, chain-transform, until-blocked)
2. Integration tests: boot → prompt → tool call → agent_end per adapter
3. E2E: full lifecycle per agent (Pi, OpenClaw, Claude Code)
4. Structured logging/tracing: every event fire logged with duration, extension, result count
5. `dot-ai diagnose` CLI command: show loaded extensions, registered resources, event subscriptions

---

## 12. Event Firing Patterns (Reference)

| Pattern | Events | Description |
|---|---|---|
| `fire()` | session_start, session_end, agent_start, agent_end, session_compact | Broadcast, collect all results |
| `fireCollectSections()` | context_enrich | Merge sections, last-wins by id |
| `fireFirstResult()` | route | Stop at first non-null result |
| `fireChainTransform()` | label_extract, input, tool_result | Each handler transforms previous |
| `fireUntilBlocked()` | tool_call | Stop at first block decision |
