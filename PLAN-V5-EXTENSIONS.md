# dot-ai v5 — Extension System Plan

> Architecture inspirée de pi, adaptée à l'approche agent-agnostic de dot-ai.
> Objectif : dot-ai couvre toutes les possibilités d'interaction avec les agents.
> Chaque adapter exploite le maximum de ce que l'agent supporte.
> Ce qui n'est pas supporté est silencieusement ignoré.
> **Breaking change assumé** — v5 est un rewrite, pas une migration douce.

## Vision

```
dot-ai v5 = providers + engine + extensions + adapters (redesigned)
           + Two-tier events (universel + agents riches)
           + Graceful degradation per adapter
           + Validated end-to-end in kiwi workspace
```

## Architecture

```
@dot-ai/core
├── types.ts             (rewrite — unified types)
├── contracts.ts         (rewrite — 7 provider interfaces + PromptProvider)
├── engine.ts            (rewrite — boot/enrich/learn, extension-aware)
├── runtime.ts           (rewrite — DotAiRuntime, extensions first-class)
├── capabilities.ts      (rewrite — merge provider + extension tools)
├── format.ts            (rewrite — progressive disclosure, tool hints)
├── hooks.ts             (rewrite — simplified, merge with extension events)
│
├── extension-api.ts     (NEW — DotAiExtensionAPI interface)
├── extension-types.ts   (NEW — event types, tool definition)
├── extension-loader.ts  (NEW — jiti-based loader + discovery)
├── extension-runner.ts  (NEW — fire events, collect results)
│
├── labels.ts            (keep — label extraction)
├── config.ts            (rewrite — support extensions + prompts config)
├── loader.ts            (rewrite — provider + extension resolution)
├── nodes.ts             (keep — workspace node discovery)
└── logger.ts            (keep — logging)
```

---

## Phase 0 — Types & Conformance Foundation

**Goal:** Define the extension API types, structurally compatible with pi.
**No runtime dep on pi-coding-agent — devDependency only for conformance tests.**

### Task 0.1 — Extension type definitions
**File:** `packages/core/src/extension-types.ts`

- `ToolDefinition` — structurally matches pi's ToolDefinition
  - `name`, `description`, `parameters` (TypeBox TSchema)
  - `execute(input) → Promise<{ content: string; details?: unknown }>`
  - `promptSnippet?: string` — injected into system prompt when tool is active
  - `promptGuidelines?: string` — guidelines for the LLM
- `ContextInjectEvent` — tier 1 (universal)
  - `{ prompt: string; labels: Label[]; usage?: { inputTokens: number; contextWindow: number } }`
- `ContextInjectResult`
  - `{ inject?: string }` — text added to context
- `ContextModifyEvent` — tier 2 (rich agents only)
  - `{ messages: Message[]; usage?: ... }`
- `ContextModifyResult`
  - `{ messages?: Message[]; inject?: string }` — modified array OR text fallback
- `ToolCallEvent`
  - `{ tool: string; input: Record<string, unknown> }`
- `ToolCallResult`
  - `{ decision?: 'allow' | 'block'; reason?: string }`
- `ToolResultEvent`
  - `{ tool: string; result: { content: string }; isError: boolean }`
- `AgentEndEvent`
  - `{ response: string }`
- `ExtensionEvent` — union type of all events
- `ExtensionTier` — `'universal' | 'rich'` — metadata per event
- `LoadedExtension`
  - `{ path: string; handlers: Map<string, Function[]>; tools: Map<string, ToolDefinition>; tiers: Set<ExtensionTier> }`

### Task 0.2 — DotAiExtensionAPI interface
**File:** `packages/core/src/extension-api.ts`

```typescript
export interface DotAiExtensionAPI {
  // ── Tier 1 Events (universal — all agents) ──
  on(event: 'context_inject', handler: (e: ContextInjectEvent) => Promise<ContextInjectResult | void>): void;
  on(event: 'tool_call', handler: (e: ToolCallEvent) => Promise<ToolCallResult | void>): void;
  on(event: 'agent_end', handler: (e: AgentEndEvent) => Promise<void>): void;
  on(event: 'session_start', handler: () => Promise<void>): void;
  on(event: 'session_end', handler: () => Promise<void>): void;

  // ── Tier 2 Events (rich agents — pi, future agents) ──
  on(event: 'context_modify', handler: (e: ContextModifyEvent) => Promise<ContextModifyResult | void>): void;
  on(event: 'tool_result', handler: (e: ToolResultEvent) => Promise<void>): void;
  on(event: 'turn_start', handler: () => Promise<void>): void;
  on(event: 'turn_end', handler: () => Promise<void>): void;

  // ── Tools ──
  registerTool(tool: ToolDefinition): void;

  // ── dot-ai Providers (superpowers — not in pi) ──
  providers: {
    memory?: {
      search(query: string, labels?: string[]): Promise<MemoryEntry[]>;
      store(entry: Omit<MemoryEntry, 'source'>): Promise<void>;
    };
    skills?: {
      match(labels: Label[]): Promise<Skill[]>;
      load(name: string): Promise<string | null>;
    };
    routing?: {
      route(labels: Label[]): Promise<RoutingResult>;
    };
    tasks?: {
      list(filter?: TaskFilter): Promise<Task[]>;
      get(id: string): Promise<Task | null>;
      create(task: Omit<Task, 'id'>): Promise<Task>;
      update(id: string, patch: Partial<Task>): Promise<Task>;
    };
  };

  // ── Inter-extension EventBus ──
  events: {
    on(event: string, handler: (...args: unknown[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
  };
}
```

### Task 0.3 — Pi conformance tests
**File:** `packages/core/tests/pi-conformance.test.ts`
**devDependency:** `@mariozechner/pi-coding-agent`

- `ToolDefinition` is structurally assignable to pi's ToolDefinition
- A function `(api: DotAiExtensionAPI) => void` is callable with pi's ExtensionAPI
  (structural subtype check — dot-ai extension = valid pi extension)
- Event handler signatures match pi's for shared events
- Run on CI to catch pi breaking changes early

### Task 0.4 — Rewrite types.ts
**File:** `packages/core/src/types.ts`

- Clean rewrite merging old types + new extension types
- Remove deprecated fields
- Add `PromptTemplate` type
- Add `BudgetWarning`, `DotAiConfig` (updated with `extensions`, `prompts` sections)

### Task 0.5 — Rewrite contracts.ts
**File:** `packages/core/src/contracts.ts`

- All 6 existing providers rewritten clean
- Add `PromptProvider` (7th provider)
- Remove `ProviderFactory` (replaced by loader)

### Task 0.6 — Rewrite index.ts exports
**File:** `packages/core/src/index.ts`

- Clean export of all types, contracts, engine, runtime, extensions
- No legacy re-exports

---

## Phase 1 — Extension Loader

**Goal:** Discover and load TypeScript extensions from .ai/extensions/

### Task 1.1 — Extension discovery
**File:** `packages/core/src/extension-loader.ts`

- Scan `.ai/extensions/` (project) + `~/.ai/extensions/` (global)
- Direct files: `*.ts`, `*.js`
- Subdirectories: `*/index.ts` or `*/index.js`
- Package dirs: `*/package.json` → read `dot-ai.extensions` field
- Dedup by resolved path
- Return `string[]` of extension paths

### Task 1.2 — Extension loading via jiti
**File:** `packages/core/src/extension-loader.ts`
**Dependency:** `jiti`

- For each path, use jiti to import the TypeScript module
- Expect `default export function(api: DotAiExtensionAPI)`
- Create a `DotAiExtensionAPI` instance backed by a `LoadedExtension` collector
- Call the factory → handlers and tools are registered on the collector
- Track which tiers the extension uses (for adapter diagnostics)
- Return `LoadedExtension[]`
- Error handling: log and skip failed extensions, never throw

### Task 1.3 — Package format support
**File:** `packages/core/src/extension-loader.ts`

- Read `package.json` `dot-ai` field:
  ```json
  { "dot-ai": { "extensions": ["src/index.ts"], "skills": ["skills/"], "providers": ["src/provider.ts"] } }
  ```
- Extensions listed in the manifest are loaded
- Skills paths are passed to SkillProvider
- Providers are loaded and registered

### Task 1.4 — Tests
**File:** `packages/core/tests/extension-loader.test.ts`

- Discovers .ts files in a temp .ai/extensions/ dir
- Discovers subdirs with index.ts
- Reads dot-ai field from package.json
- Loads extension factory, collects registered handlers and tools
- Handles errors gracefully (bad exports, syntax errors)
- Deduplicates paths
- Tracks extension tiers correctly

---

## Phase 2 — Extension Runner

**Goal:** Fire events and collect results from loaded extensions.

### Task 2.1 — ExtensionRunner class
**File:** `packages/core/src/extension-runner.ts`

```typescript
export class ExtensionRunner {
  constructor(extensions: LoadedExtension[], logger?: Logger)

  /** Fire an event and collect results from all extensions */
  async fire<T>(event: string, data?: unknown): Promise<T[]>

  /** Fire an event, stop at first blocking result (for tool_call) */
  async fireUntilBlocked(event: 'tool_call', data: ToolCallEvent): Promise<ToolCallResult | null>

  /** Get all registered tools across extensions */
  get tools(): ToolDefinition[]

  /** Get diagnostic info */
  get diagnostics(): ExtensionDiagnostic[]

  /** Which tiers are used by loaded extensions */
  get usedTiers(): Set<ExtensionTier>
}
```

- `fire(event, data)` — iterate all extensions, call matching handlers, collect non-void results
- `fireUntilBlocked()` — for tool_call: stop at first `{ decision: 'block' }`, return it
- `tools` — merge all extension tool maps
- `diagnostics` — for each extension: path, handler count per event, tool names, tiers used
- `usedTiers` — aggregate of all extension tiers (for adapter degradation warnings)

### Task 2.2 — EventBus for inter-extension comms
**File:** `packages/core/src/extension-runner.ts`

- Simple EventEmitter pattern: `on(event, handler)`, `emit(event, ...args)`
- Shared across all extensions in a session
- No persistence — in-memory only

### Task 2.3 — Tests
**File:** `packages/core/tests/extension-runner.test.ts`

- Fires events to registered handlers
- Collects results from handlers
- `fireUntilBlocked` stops at first block
- Handles errors in handlers (log and continue, don't break other extensions)
- Tools are merged across extensions, conflicts reported in diagnostics
- EventBus works for inter-extension communication
- Diagnostics report correct counts and tiers

---

## Phase 3 — Runtime Rewrite

**Goal:** DotAiRuntime with extensions as first-class citizens.

### Task 3.1 — Rewrite DotAiRuntime
**File:** `packages/core/src/runtime.ts`

```typescript
export class DotAiRuntime {
  // Boot: config → providers → extensions → cache → session_start
  async boot(): Promise<void>

  // Process prompt: enrich → extensions context_inject → format
  async processPrompt(prompt: string): Promise<ProcessResult>

  // Fire an event (for adapters to call on agent-native events)
  async fire<T>(event: string, data?: unknown): Promise<T[]>
  async fireToolCall(event: ToolCallEvent): Promise<ToolCallResult | null>

  // Learn from response + fire agent_end
  async learn(response: string): Promise<void>

  // Shutdown: fire session_end, flush logger
  async shutdown(): Promise<void>

  // Accessors
  get capabilities(): Capability[]
  get providers(): Providers
  get runner(): ExtensionRunner
  get diagnostics(): RuntimeDiagnostics  // includes extension diagnostics
}
```

- `processPrompt()` now fires `context_inject` after enrichment and appends results
- `learn()` fires `agent_end` event before storing in memory
- `shutdown()` fires `session_end` and flushes
- `diagnostics` includes: loaded extensions, tier usage, provider status, capability count

### Task 3.2 — Rewrite capabilities.ts
**File:** `packages/core/src/capabilities.ts`

- `buildCapabilities(providers, extensionTools)` — merge both sources
- `toolDefinitionToCapability(tool: ToolDefinition): Capability` — bridge
- Capability gets `promptSnippet?: string` and `promptGuidelines?: string`
- Clean up JSON Schema generation

### Task 3.3 — Rewrite format.ts
**File:** `packages/core/src/format.ts`

- Add `skillDisclosure: 'full' | 'progressive'` option
  - `progressive`: name + description only, with read instruction
  - `full`: entire content (current behavior)
- Add `formatToolHints(capabilities)` — tools with promptSnippet/Guidelines
- Clean up section ordering and formatting

### Task 3.4 — Rewrite engine.ts
**File:** `packages/core/src/engine.ts`

- `boot()` — loads extensions, builds cache, fires session_start
- `enrich()` — labels → providers → enriched context (no change in logic, cleaner code)
- `learn()` — memory store + after_learn hooks (simplified)
- Remove v4 hook runner from engine (moved to runtime)

### Task 3.5 — Rewrite config.ts
**File:** `packages/core/src/config.ts`

- Support `extensions` section in dot-ai.yml:
  ```yaml
  extensions:
    paths: [".ai/extensions/", "~/.ai/extensions/"]
    packages: ["@dot-ai/security-gates"]
  prompts:
    use: "@dot-ai/file-prompts"
    with:
      dirs: ".ai/prompts/"
  ```
- Clean YAML parsing

### Task 3.6 — Tests
**File:** `packages/core/tests/runtime.test.ts`

- Full lifecycle: boot → processPrompt → learn → shutdown
- Extensions loaded at boot, events fired correctly
- Extension tools appear in capabilities
- Provider access works from extension API
- `context_inject` results appended to formatted output
- Progressive skill disclosure works
- Tool hints formatted correctly
- Config with extensions section parsed correctly

---

## Phase 4 — Adapter Rewrites

**Goal:** Each adapter translates dot-ai events to agent-native mechanisms.

### Task 4.1 — Adapter Claude Code (rewrite)
**File:** `packages/adapter-claude/src/hook.ts`

- `SessionStart`:
  - Boot runtime
  - Fire `session_start`
  - Log degradation warnings (tier 2 events used but unsupported)
- `UserPromptSubmit`:
  - `runtime.processPrompt(prompt)` (includes `context_inject` firing)
  - Return formatted output
- `PreToolUse`:
  - `runtime.fireToolCall({ tool, input })`
  - If blocked → return `{ decision: 'block', reason }`
  - (replaces hardcoded memory file blocking — now extension-driven)
- `Stop`:
  - `runtime.learn(response)` (fires `agent_end` internally)
- `PreCompact`:
  - Store compaction summary in memory
- MCP server: expose `runtime.capabilities` as tools
- Diagnostics: log at boot which features are degraded

### Task 4.2 — Adapter OpenClaw (rewrite)
**File:** `packages/adapter-openclaw/src/index.ts`

- `before_agent_start`:
  - Boot runtime (first call)
  - `runtime.processPrompt(prompt)` → return enriched context
- `after_agent_end`:
  - `runtime.learn(response)`
- Tool registration: `runtime.capabilities` → `api.registerTool()` per tool
- Fire `tool_call` on `before_tool_call` if OpenClaw API supports it

### Task 4.3 — Adapter Pi (NEW package)
**File:** `packages/adapter-pi/src/index.ts`
**package.json:** `@dot-ai/adapter-pi`

- This IS a pi extension: `export default function(pi: ExtensionAPI)`
- `pi.on('session_start')`:
  - Boot DotAiRuntime
  - Register `runtime.capabilities` as pi tools via `pi.registerTool()`
- `pi.on('before_agent_start')`:
  - `runtime.processPrompt(lastUserMessage)` → return `{ systemPrompt: formatted }`
- `pi.on('context')`:
  - `runtime.fire('context_modify', { messages })` → return modified messages
- `pi.on('tool_call')`:
  - `runtime.fireToolCall({ tool, input })` → return block if needed
- `pi.on('tool_result')`:
  - `runtime.fire('tool_result', { tool, result, isError })`
- `pi.on('agent_end')`:
  - `runtime.learn(response)`
- `pi.on('session_shutdown')`:
  - `runtime.shutdown()`
- **Full fidelity** — all tiers supported, zero degradation

### Task 4.4 — Adapter Sync (rewrite)
**File:** `packages/adapter-sync/src/sync.ts`

- Boot runtime
- `runtime.processPrompt('')` → get formatted context
- Extension tools with `promptSnippet` → inject into synced file
- No event support — fire `context_inject` one-shot only
- Write to `.cursorrules` or `.github/copilot-instructions.md`

### Task 4.5 — Adapter capability matrix (documented)
**File:** `packages/core/src/extension-types.ts`

```typescript
/** Capability matrix — which events each agent supports */
export const ADAPTER_CAPABILITIES: Record<string, Set<string>> = {
  'pi':          new Set(['context_inject', 'context_modify', 'tool_call', 'tool_result', 'agent_end', 'session_start', 'session_end', 'turn_start', 'turn_end']),
  'claude-code': new Set(['context_inject', 'tool_call', 'agent_end', 'session_start']),
  'openclaw':    new Set(['context_inject', 'agent_end', 'session_start']),
  'cursor':      new Set(['context_inject']),
  'copilot':     new Set(['context_inject']),
};
```

---

## Phase 5 — Kiwi Integration & Validation

**Goal:** Wire v5 into kiwi workspace. Test everything end-to-end.
**This is NOT optional — no release without kiwi validation.**

### Task 5.1 — Write test extensions for kiwi
**Dir:** `~/dev/kiwi/.ai/extensions/`

Extension 1: `security-gate.ts`
- Block writes to `.env`, `*.key`, `*.pem` files
- Block `rm -rf /` in bash commands
- Uses `tool_call` event (tier 1)

Extension 2: `smart-context.ts`
- On `context_inject`, search memory for related context
- Uses `api.providers.memory.search()`
- Injects relevant memories as additional context

Extension 3: `session-analytics.ts`
- Count tool calls, track which tools used most
- On `agent_end`, log stats
- Uses `tool_call` + `agent_end` events

### Task 5.2 — Update kiwi's dot-ai.yml
**File:** `~/dev/kiwi/.ai/dot-ai.yml`

- Add `extensions` section pointing to `.ai/extensions/`
- Update adapter config for v5 API

### Task 5.3 — Update kiwi's adapter-claude hook
**File:** `~/dev/kiwi/.claude/hooks.json`

- Point to v5 adapter-claude
- Verify SessionStart → UserPromptSubmit → PreToolUse → Stop flow

### Task 5.4 — End-to-end validation checklist

Run each test manually in kiwi with Claude Code:

- [ ] **Boot**: runtime boots, extensions loaded, capabilities registered
- [ ] **Context inject**: smart-context extension injects memories
- [ ] **Tool call block**: security-gate blocks write to `.env`
- [ ] **Tool call allow**: normal writes go through
- [ ] **Agent end**: session-analytics logs stats
- [ ] **MCP tools**: memory_recall, memory_store work via MCP
- [ ] **Provider access**: extension can search memory via `api.providers.memory`
- [ ] **Diagnostics**: boot logs show loaded extensions, tier warnings
- [ ] **Error resilience**: bad extension doesn't crash boot
- [ ] **Progressive disclosure**: skills show name+desc only (if enabled)

### Task 5.5 — Performance validation

- [ ] Boot time < 500ms (with extensions)
- [ ] `processPrompt()` < 200ms (with context_inject)
- [ ] No memory leaks after 50+ prompts
- [ ] Extension errors don't slow down the pipeline

---

## Phase 6 — Review, Clean, Improve

**Goal:** Production-quality code. No shortcuts.

### Task 6.1 — Architecture review

- Review all new files against pi's patterns — are we structurally compatible?
- Run pi conformance tests
- Review adapter capability matrix — any missing mappings?
- Check: can a dot-ai extension actually run in pi? Write a test.

### Task 6.2 — Code review

- All files < 300 lines (split if larger)
- No `any` types — strict TypeScript
- Error handling: every async path has try/catch at boundary
- Logger used consistently — no console.log
- Naming conventions consistent with v4 where still applicable

### Task 6.3 — Test coverage

- Unit tests for every public function
- Integration tests for runtime lifecycle
- Edge cases: no extensions, no providers, empty config, broken extensions
- At least one test per event type × adapter combination
- Conformance tests pass against pi types

### Task 6.4 — API surface review

- Is the DotAiExtensionAPI minimal enough?
- Can we remove any event types that no adapter uses?
- Is the provider access surface right? Too much? Too little?
- Are capability types clean?

### Task 6.5 — Clean up

- Remove all v4 code that was replaced (not "deprecated", deleted)
- Remove compatibility shims
- Update all package.json versions to 5.0.0
- Update all internal deps
- Ensure `pnpm nx run-many -t build` passes
- Ensure `pnpm nx run-many -t test` passes
- Ensure `pnpm nx run-many -t lint` passes

---

## Phase 7 — Prompt Templates & Package Manager

**Goal:** Quality-of-life features from pi's ecosystem.

### Task 7.1 — PromptProvider contract + FilePromptProvider
**Files:** `packages/core/src/contracts.ts`, `packages/file-prompts/` (new package)

- `PromptProvider.list()`, `PromptProvider.load(name)`
- FilePromptProvider: scan `.ai/prompts/`, parse frontmatter, detect $args
- Wire into engine + format

### Task 7.2 — Package manager
**File:** `packages/core/src/package-manager.ts`

- `install(source)` — npm or git
- `update(name)`, `remove(name)`, `list()`
- `resolve()` — read `dot-ai` manifest from installed packages
- CLI commands: `dot-ai install`, `dot-ai update`, `dot-ai remove`, `dot-ai list`

### Task 7.3 — Tests
- Prompt templates discovered and loaded
- Package install/remove/list works
- Manifest resolution returns correct paths

---

## Phase 8 — Documentation

### Task 8.1 — Extension authoring guide
**File:** `docs/extensions.md`

- How to write a dot-ai extension
- Tier 1 vs tier 2 events
- Provider access from extensions
- Tool registration with promptSnippet
- Distribution via npm/git
- Examples with full code

### Task 8.2 — Architecture doc
**File:** `docs/architecture.md`

- Extension system design
- Adapter capability matrix
- Event flow diagrams
- Provider → Extension → Adapter data flow

### Task 8.3 — Update dot-ai repo AGENTS.md
- v5 architecture overview
- New file structure
- Extension loading flow

---

## Implementation Order

```
Phase 0 (types + conformance)    ████░░░░░░  ~3h    ← foundation
Phase 1 (loader)                 ████░░░░░░  ~3h    ← discovery + jiti
Phase 2 (runner)                 ███░░░░░░░  ~2h    ← event firing
Phase 3 (runtime rewrite)        █████░░░░░  ~5h    ← core rewrite
Phase 4 (adapter rewrites)       ██████░░░░  ~6h    ← 4 adapters
Phase 5 (kiwi validation)        █████░░░░░  ~4h    ← E2E testing
Phase 6 (review + clean)         ████░░░░░░  ~4h    ← quality gate
Phase 7 (prompts + pkg mgr)      ████░░░░░░  ~4h    ← nice-to-have
Phase 8 (docs)                   ██░░░░░░░░  ~2h    ← docs
                                                    ------
                                                    ~33h total
```

**Quality gates between phases:**
- After Phase 2: `pnpm nx test core` passes — extension system works in isolation
- After Phase 4: all adapters build + unit tests pass
- After Phase 5: **kiwi works end-to-end** — 10-point checklist all green
- After Phase 6: **ship-ready** — no TODOs, no anys, all tests green, pi conformance passes

---

## Key Design Decisions

1. **No runtime dep on pi** — structural typing + devDep conformance tests
2. **Two-tier events** — tier 1 universal, tier 2 gracefully degraded with warnings
3. **Extensions access providers** — `api.providers.memory.search()` etc.
4. **Load-once, fire-many** — extensions loaded at boot, events fired by adapters
5. **dot-ai package format** — `"dot-ai"` field in package.json
6. **jiti for TS loading** — zero build step for extensions
7. **Adapters decide execution** — core collects, adapters translate and run
8. **Breaking change** — v5 is a clean rewrite, no v4 compat layer
9. **Kiwi-validated** — no release without end-to-end proof in production workspace
10. **Quality gate** — review + clean phase is mandatory, not optional
