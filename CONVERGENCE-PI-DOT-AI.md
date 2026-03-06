# @dot-ai/extension-core — Convergence with Pi

> This document defines `@dot-ai/extension-core`: a standalone package extracting
> the generic extension primitives shared between Pi, Claude Code, OpenClaw, and
> any future agent. It covers the API surface, differences with Pi, maintenance
> strategy, and how Pi could adopt this package.

---

## 1. What gets extracted from `@dot-ai/core`

Today, `@dot-ai/core` mixes **workspace concerns** (config, providers, memory, skills, routing) with **extension primitives** (event bus, tool registration, command registration, extension loading).

`@dot-ai/extension-core` isolates the extension primitives:

```
@dot-ai/extension-core          @dot-ai/core (keeps)
├── extension-types.ts           ├── config.ts
│   ToolDefinition               ├── loader.ts (providers)
│   CommandDefinition            ├── engine.ts
│   EventTypes (all)             ├── format.ts
│   LoadedExtension              ├── capabilities.ts
│   ExtensionDiagnostic          ├── hooks.ts
│   EVENT_TIERS                  ├── labels.ts
│   ADAPTER_CAPABILITIES         ├── nodes.ts
├── extension-api.ts             ├── runtime.ts (imports extension-core)
│   ExtensionAPI interface       └── types.ts (domain types)
├── extension-runner.ts
│   EventBus
│   ExtensionRunner
├── extension-loader.ts
│   discoverExtensions
│   loadExtensions
│   createCollectorAPI
└── index.ts (re-exports all)
```

`@dot-ai/core` would depend on `@dot-ai/extension-core` and re-export its types for backwards compatibility.

---

## 2. API Surface Comparison: Pi vs dot-ai

### 2.1 Extension Registration Pattern

| Aspect | Pi (`pi-coding-agent`) | dot-ai (`extension-core`) |
|--------|----------------------|--------------------------|
| Entry point | `module.exports = function(pi) { ... }` | `module.exports = function(api) { ... }` |
| Parameter name | `pi` (convention) | `api` (convention) |
| Return value | `void` | `void \| Promise<void>` |
| Async support | Sync only (register phase) | Sync or async |
| Loading | `require()` via Node | `jiti` (TS) or `import()` |

**Convergence:** Identical pattern. An extension written for dot-ai can work in Pi with zero changes if it only uses shared primitives.

### 2.2 Event System

| Event | Pi | dot-ai | Same Semantics? |
|-------|-----|--------|-----------------|
| `session_start` | ✅ `(ctx)` | ✅ `()` | ⚠️ Pi passes rich ctx |
| `session_end` / `session_shutdown` | ✅ `shutdown` | ✅ `session_end` | ⚠️ Different name |
| `before_agent_start` | ✅ `(event, ctx)` | ❌ (via processPrompt) | ❌ Different model |
| `context` / `context_inject` | ✅ `context` | ✅ `context_inject` | ⚠️ Different name |
| `context_modify` | ❌ | ✅ | dot-ai only |
| `tool_call` | ✅ `(event, ctx)` | ✅ `(event)` | ⚠️ Pi has richer ctx |
| `tool_result` | ✅ `(event, ctx)` | ✅ `(event)` | ⚠️ Pi has richer ctx |
| `agent_end` | ✅ `(event, ctx)` | ✅ `(event)` | ⚠️ Pi has richer ctx |
| `input` | ✅ `(event, ctx)` | 🔜 v5.1 | Will converge |
| `turn_start` / `turn_end` | ❌ | ✅ | dot-ai only |
| `model_select` | ✅ | ❌ | Pi only |
| `session_switch` / `session_fork` | ✅ | ❌ | Pi only (multi-session) |
| `session_compact` | ✅ | ❌ | Pi only |

**Key differences:**

1. **Event handler signature**: Pi passes `(event, ctx)` where `ctx` includes session/UI control. dot-ai passes `(event)` only — no session control.
2. **Event naming**: Pi uses `context`, dot-ai uses `context_inject`. Pi uses `session_shutdown`, dot-ai uses `session_end`.
3. **Return value semantics**: Both use return values to signal decisions (block, inject, transform). Same pattern.

### 2.3 Tool Registration

| Aspect | Pi | dot-ai |
|--------|-----|--------|
| Method | `pi.registerTool(tool)` | `api.registerTool(tool)` |
| `name` | ✅ | ✅ |
| `description` | ✅ | ✅ |
| `parameters` | ✅ JSON Schema | ✅ JSON Schema |
| `execute(input)` | ✅ `→ { content }` | ✅ `→ { content, details? }` |
| `promptSnippet` | ✅ | ✅ |
| `promptGuidelines` | ✅ | ✅ |
| `autoExecute` | ✅ | ❌ |
| `autoExecuteIf` | ✅ | ❌ |
| `when` (conditional) | ✅ | ❌ |

**Convergence:** `ToolDefinition` is structurally identical for the shared fields. dot-ai adds `details?` in the result. Pi adds `autoExecute`, `autoExecuteIf`, `when` (agent-specific runtime behavior that doesn't belong in a generic package).

### 2.4 Command Registration

| Aspect | Pi | dot-ai (v5.1 plan) |
|--------|-----|---------------------|
| Method | `pi.registerCommand(name, opts)` | `api.registerCommand(cmd)` |
| `name` | ✅ | ✅ |
| `description` | ✅ | ✅ |
| `handler(args, ctx)` | ✅ | ✅ (as `execute(args, ctx)`) |
| `getArgumentCompletions` | ✅ | ✅ (via `parameters[].completions`) |
| Parameters schema | ❌ (freeform args) | ✅ (named parameters) |
| Result type | Returns string/void | Returns `CommandResult` (text, inject, handled) |
| Visibility | ❌ | ✅ (`visible` flag) |

**Convergence:** Same concept, slightly different API shape. dot-ai's `CommandDefinition` is a superset of Pi's.

### 2.5 Shortcuts

| Aspect | Pi | dot-ai |
|--------|-----|--------|
| `registerShortcut(key, opts)` | ✅ | ❌ |

Shortcuts are UI-specific (terminal key bindings). Not applicable to non-TUI agents. **Should NOT be in extension-core.**

### 2.6 Context Object (`ctx`)

Pi passes a rich `ctx` to every handler:

```typescript
// Pi's ctx — available in every event handler
ctx.session          // Session management
ctx.getMessages()    // Conversation history
ctx.addMessage()     // Inject messages
ctx.cycleModel()     // Switch model
ctx.setThinkingLevel() // Adjust reasoning budget
ctx.setSystemPrompt()  // Modify system prompt
ctx.abort()          // Cancel current operation
ctx.compact()        // Trigger compaction
```

dot-ai passes minimal context:
```typescript
// dot-ai's context — only in commands (v5.1)
ctx.workspaceRoot    // Workspace path
ctx.rawArgs          // Raw argument string
ctx.providers        // dot-ai providers (memory, skills, etc.)
ctx.events           // EventBus
```

**Key insight:** Pi's `ctx` is **agent-specific runtime control**. It can't be generalized because each agent has different runtime capabilities. extension-core should define a **minimal base context** and let adapters extend it.

### 2.7 Inter-Extension Communication

| Aspect | Pi `createEventBus()` | dot-ai `EventBus` class |
|--------|---------------------|-------------------------|
| Pattern | Factory function | Class constructor |
| `on(event, handler)` | ✅ | ✅ |
| `emit(event, ...args)` | ✅ | ✅ |
| `off(event, handler)` | ✅ | ❌ |
| Typing | Generic type param | String-keyed |

**Convergence:** Functionally identical. dot-ai should add `off()` for parity.

---

## 3. The Extension-Core API

The unified API that `@dot-ai/extension-core` exports:

```typescript
// === Core Types ===

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<{ content: string; details?: unknown }>;
  promptSnippet?: string;
  promptGuidelines?: string;
}

export interface CommandDefinition {
  name: string;
  description: string;
  parameters?: CommandParameter[];
  execute(args: Record<string, string>, ctx: CommandContext): Promise<CommandResult | void>;
  visible?: boolean;
}

export interface CommandParameter {
  name: string;
  description: string;
  required?: boolean;
  completions?: (prefix: string) => string[] | Promise<string[]>;
}

export interface CommandContext {
  workspaceRoot: string;
  rawArgs: string;
  // Adapters extend this with agent-specific context
  [key: string]: unknown;
}

export interface CommandResult {
  text?: string;
  inject?: string;
  handled?: boolean;
}

// === Event Types ===
// (all existing: ContextInjectEvent, ToolCallEvent, etc.)
// (new: InputTransformEvent, InputTransformResult)

// === Event Tiers ===
export type ExtensionTier = 'universal' | 'rich';
export const EVENT_TIERS: Record<string, ExtensionTier>;

// === Adapter Capability Matrix ===
export const ADAPTER_CAPABILITIES: Record<string, Set<string>>;

// === Extension API (passed to extensions) ===
export interface ExtensionAPI {
  on(event: string, handler: Function): void;
  registerTool(tool: ToolDefinition): void;
  registerCommand(command: CommandDefinition): void;
  events: EventBus;
  // NOTE: No providers here — those are dot-ai-specific.
  // Adapters extend this interface.
}

// === EventBus ===
export class EventBus {
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
}

// === ExtensionRunner ===
export class ExtensionRunner {
  constructor(extensions: LoadedExtension[], logger?: Logger);
  fire<T>(event: string, data?: unknown): Promise<T[]>;
  fireUntilBlocked(event: string, data: unknown): Promise<{ decision: string; reason?: string } | null>;
  fireInputTransform(event: InputTransformEvent): Promise<InputTransformResult | null>;
  get tools(): ToolDefinition[];
  get commands(): CommandDefinition[];
  get diagnostics(): ExtensionDiagnostic[];
  get usedTiers(): Set<ExtensionTier>;
}

// === Extension Loader ===
export function discoverExtensions(root: string, config?: ExtensionsConfig): Promise<string[]>;
export function loadExtensions(paths: string[], api: Partial<ExtensionAPI>, logger?: Logger): Promise<LoadedExtension[]>;
```

---

## 4. What Pi has that extension-core does NOT include

These are **agent-specific** features that belong in the adapter, not the shared package:

| Feature | Why not in extension-core |
|---------|--------------------------|
| `ctx.session` (session management) | Agent-specific lifecycle |
| `ctx.cycleModel()` / `ctx.setThinkingLevel()` | Agent-specific model control |
| `ctx.getMessages()` / `ctx.addMessage()` | Agent-specific message management |
| `ctx.setSystemPrompt()` | Agent-specific prompt control |
| `ctx.compact()` / `ctx.abort()` | Agent-specific flow control |
| `registerShortcut()` | TUI-specific (Pi only) |
| `autoExecute` / `autoExecuteIf` | Agent-specific tool behavior |
| `model_select` event | Agent-specific |
| `session_switch` / `session_fork` events | Multi-session (Pi only) |

**Principle:** extension-core provides the **registration and dispatch** primitives. Agent-specific behavior stays in the adapter.

---

## 5. What dot-ai has that Pi does NOT

| Feature | In extension-core? | Notes |
|---------|-------------------|-------|
| `context_modify` (message rewriting) | ✅ | Rich tier, Pi could adopt |
| `turn_start` / `turn_end` events | ✅ | Rich tier, Pi could adopt |
| `providers` in API (memory, skills, etc.) | ❌ | dot-ai-specific, stays in `DotAiExtensionAPI` |
| `ADAPTER_CAPABILITIES` matrix | ✅ | Generic capability declaration |
| `EVENT_TIERS` (universal/rich) | ✅ | Tier system for graceful degradation |
| `ExtensionDiagnostic` | ✅ | Debugging/observability |

---

## 6. Maintenance Strategy

### 6.1 How to track Pi changes

Pi is actively developed at `github.com/badlogic/pi-mono`. The extension API surface is defined in:

```
pi-mono/packages/agent-core/src/extensions.ts  → ExtensionAPI, types
pi-mono/packages/agent-core/src/events.ts      → Event definitions
pi-mono/packages/agent-core/src/tools.ts       → ToolDefinition
```

**Monitoring approach:**
1. Watch `pi-mono` releases for breaking changes in `agent-core`
2. Key files to track: `extensions.ts`, `events.ts`, `tools.ts`
3. Pi uses semver — minor/patch versions add features, majors may break

### 6.2 When Pi adds a new event

1. **Check if it's universal or agent-specific:**
   - Universal (applicable to 2+ agents) → Add to `extension-core` EVENT_TIERS
   - Agent-specific (e.g., `session_compact`) → Pi adapter handles natively
2. **Add to ADAPTER_CAPABILITIES** for the relevant adapters
3. **Update ExtensionAPI** with typed overload if universal

### 6.3 When Pi changes ToolDefinition

Pi's `ToolDefinition` is the anchor type. If Pi adds fields:
- **Additive (new optional fields):** Add to extension-core, no breaking change
- **Breaking (rename/remove):** Create compatibility shim in Pi adapter

### 6.4 When Pi changes event handler signatures

Pi's handlers take `(event, ctx)` while extension-core takes `(event)`.
- The Pi adapter already bridges this — it wraps extension-core handlers to inject `ctx`
- If Pi changes `ctx` shape, only `adapter-pi` needs updating

### 6.5 Versioning policy

```
extension-core 1.x  — initial extraction, stable API
extension-core 1.y  — additive events/types from Pi or other agents
extension-core 2.x  — breaking changes (rare, coordinated with Pi releases)
```

---

## 7. How Pi could adopt extension-core

### Strategy A: Pi depends on `@dot-ai/extension-core`

Pi replaces its internal extension types with imports from extension-core:

```typescript
// pi-mono/packages/agent-core/src/extensions.ts
import type {
  ToolDefinition,
  CommandDefinition,
  ExtensionAPI as BaseExtensionAPI,
  EventBus,
} from '@dot-ai/extension-core';

// Pi extends the base API with agent-specific features
export interface PiExtensionAPI extends BaseExtensionAPI {
  registerShortcut(key: string, opts: ShortcutOptions): void;

  // Override event handlers to include ctx
  on(event: 'tool_call', handler: (e: ToolCallEvent, ctx: PiContext) => Promise<ToolCallResult | void>): void;
  // ... etc
}
```

**Pros:** Single source of truth for shared types. Pi gets commands, input transforms, tiers for free.
**Cons:** Pi takes a dependency on an external package. Mario may not want that.

### Strategy B: Pi stays independent, extension-core stays compatible

Extension-core maintains structural compatibility with Pi's types:

```typescript
// extension-core guarantees:
// 1. ToolDefinition is a subset of Pi's ToolDefinition
// 2. Event names map 1:1 where applicable
// 3. Extension factory signature is identical
```

Adapters bridge any differences. This is the **current approach** and works well.

**Pros:** No coupling. Each project evolves independently.
**Cons:** Manual sync when types diverge.

### Strategy C: Shared types package (neutral ground)

Create `@agent-extensions/core` — a minimal, agent-agnostic package that both Pi and dot-ai depend on:

```
@agent-extensions/core
├── tool.ts          → ToolDefinition
├── command.ts       → CommandDefinition
├── events.ts        → Base event types
├── event-bus.ts     → EventBus
└── api.ts           → BaseExtensionAPI
```

**Pros:** Truly neutral. Neither Pi nor dot-ai "owns" the types.
**Cons:** Third package to maintain. Coordination overhead.

### Recommended: Strategy B now, Strategy A later

Start with Strategy B (what we already do). If Pi shows interest, propose Strategy A or C. The key is that **extension-core's types are already structurally compatible** — adoption is a matter of imports, not rewriting.

---

## 8. Compatibility Matrix

Extensions written for extension-core work across agents:

```
Extension uses...              Pi    Claude Code    OpenClaw    Cursor    Copilot
────────────────────────       ───   ───────────    ────────    ──────    ───────
on('context_inject', ...)       ✅       ✅            ✅         ✅*       ✅*
on('tool_call', ...)            ✅       ✅            ✅**       ❌        ❌
on('agent_end', ...)            ✅       ✅            ✅         ❌        ❌
on('session_start', ...)        ✅       ✅            ✅         ❌        ❌
on('input', ...)                ✅       ✅            ❌         ❌        ❌
registerTool(...)               ✅       ✅            ✅         ❌        ❌
registerCommand(...)            ✅       ✅            ✅***      ❌        ❌
events.on/emit                  ✅       ✅            ✅         ❌        ❌

*   Cursor/Copilot: context_inject via rules file injection
**  OpenClaw: tool_call via plugin API
*** OpenClaw: commands via plugin commands (if API supports it)
```

---

## 9. Migration Path from current @dot-ai/core

### Step 1: Create package

```bash
packages/extension-core/
├── package.json    # @dot-ai/extension-core
├── tsconfig.json
└── src/
    ├── index.ts
    ├── types.ts           # ← from core/extension-types.ts
    ├── api.ts             # ← from core/extension-api.ts (base only, no providers)
    ├── runner.ts          # ← from core/extension-runner.ts
    ├── loader.ts          # ← from core/extension-loader.ts
    └── __tests__/
        ├── runner.test.ts
        ├── loader.test.ts
        └── event-bus.test.ts
```

### Step 2: Update @dot-ai/core

```typescript
// packages/core/src/extension-types.ts
export * from '@dot-ai/extension-core/types';

// packages/core/src/extension-runner.ts
export { ExtensionRunner, EventBus } from '@dot-ai/extension-core/runner';

// packages/core/src/extension-api.ts
import type { ExtensionAPI } from '@dot-ai/extension-core';

// Extend with dot-ai-specific providers
export interface DotAiExtensionAPI extends ExtensionAPI {
  providers: {
    memory?: { ... };
    skills?: { ... };
    routing?: { ... };
    tasks?: { ... };
  };
}
```

### Step 3: Backwards compatibility

All existing imports from `@dot-ai/core` continue to work:

```typescript
// Before (still works):
import { ExtensionRunner, EventBus } from '@dot-ai/core';
import type { ToolDefinition, LoadedExtension } from '@dot-ai/core';

// New option:
import { ExtensionRunner, EventBus } from '@dot-ai/extension-core';
import type { ToolDefinition, LoadedExtension } from '@dot-ai/extension-core';
```

---

## 10. Summary — What's shared, what's not

```
┌──────────────────────────────────────────────────────────┐
│                  @dot-ai/extension-core                   │
│                                                          │
│  Shared primitives that ANY agent can use:               │
│  • ToolDefinition (name, desc, params, execute)          │
│  • CommandDefinition (name, desc, params, execute)       │
│  • Event system (on, fire, fireUntilBlocked)             │
│  • Input transform (intercept/modify user input)         │
│  • EventBus (inter-extension communication)              │
│  • Extension loading (discover, load, collect)           │
│  • Tier system (universal/rich degradation)              │
│  • Adapter capability matrix                             │
│  • Diagnostics                                           │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  NOT included (agent-specific):                          │
│  • Pi: ctx.session, cycleModel, setThinkingLevel,        │
│        registerShortcut, autoExecute, session_compact     │
│  • dot-ai: providers (memory, skills, routing, tasks)    │
│  • Claude Code: hook security rules, memory file blocking│
│  • OpenClaw: plugin lifecycle, service registration      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```
