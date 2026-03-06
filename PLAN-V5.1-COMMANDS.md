# dot-ai v5.1 — Commands, Input & Generic Agent Primitives

> Objectif : dot-ai couvre TOUTES les primitives partagées par les agents.
> Chaque feature est définie de manière générique dans core, puis connectée à chaque agent via son adapter.
> Si l'agent ne supporte pas une feature, elle est silencieusement ignorée.

## Feature Matrix — What agents actually support

```
                        Pi    Claude Code    OpenClaw    Cursor    Copilot
                        ───   ───────────    ────────    ──────    ───────
Tools (registerTool)     ✅       ✅            ✅         ❌        ❌
Events (on/fire)         ✅       ✅            ✅         ❌        ❌
Commands (slash)         ✅       ✅            ✅*        ❌        ❌
Input transform          ✅       ✅**          ❌         ❌        ❌
Context inject           ✅       ✅            ✅         ✅        ✅
Context modify           ✅       ❌            ❌         ❌        ❌
Tool call intercept      ✅       ✅            ❌         ❌        ❌
Tool result observe      ✅       ❌            ❌         ❌        ❌
Turn lifecycle           ✅       ❌            ❌         ❌        ❌
Session lifecycle        ✅       ✅            ✅         ❌        ❌
Prompt templates         ✅       ✅***         ✅*        ❌        ❌

*  OpenClaw: via plugin system
** Claude Code: via UserPromptSubmit hook (can transform/block)
*** Claude Code: via /slash commands in hooks
```

## What's missing in dot-ai v5 today

| Primitive | Pi | Claude Code | dot-ai v5 | Gap |
|-----------|-----|-------------|-----------|-----|
| **Commands** | `pi.registerCommand(name, { handler })` | Plugin commands (`/command` in skills) | ❌ | **NEW** |
| **Input transform** | `pi.on('input', handler)` | `UserPromptSubmit` can return modified result | ❌ | **NEW** |
| **Prompt templates** | `.pi/prompts/*.md` with frontmatter | `/slash` commands via skills | PromptProvider exists but not wired to extensions | **Wire up** |
| **Completions** | `getArgumentCompletions(prefix)` | Tab completions in CLI | ❌ | **NEW** (nice-to-have) |

---

## Architecture

```
@dot-ai/core v5.1
├── extension-types.ts    (+ CommandDefinition, InputTransformEvent/Result)
├── extension-api.ts      (+ registerCommand(), on('input', ...))
├── extension-loader.ts   (+ collect commands)
├── extension-runner.ts   (+ commands getter, fireInputTransform())
├── runtime.ts            (+ commands getter, processInput())
├── capabilities.ts       (unchanged)
└── format.ts             (unchanged)
```

---

## Phase 0 — CommandDefinition type

**File:** `packages/core/src/extension-types.ts`

### CommandDefinition

```typescript
/** A slash command registered by an extension */
export interface CommandDefinition {
  /** Command name (without slash). e.g. "deploy", "status" */
  name: string;
  /** User-facing description */
  description: string;
  /** Parameter definitions for argument parsing */
  parameters?: CommandParameter[];
  /** Execute the command. Return text response or void. */
  execute(args: Record<string, string>, ctx: CommandContext): Promise<CommandResult | void>;
  /** Whether this command is visible in help/autocomplete. Default: true */
  visible?: boolean;
}

/** A command parameter */
export interface CommandParameter {
  name: string;
  description: string;
  required?: boolean;
  /** Tab completion suggestions */
  completions?: (prefix: string) => string[] | Promise<string[]>;
}

/** Context passed to command execution */
export interface CommandContext {
  /** Current workspace root */
  workspaceRoot: string;
  /** The raw argument string (everything after /command) */
  rawArgs: string;
  /** Access to dot-ai providers */
  providers: DotAiExtensionAPI['providers'];
  /** Inter-extension event bus */
  events: DotAiExtensionAPI['events'];
}

/** Command execution result */
export interface CommandResult {
  /** Text to display to the user */
  text?: string;
  /** Text to inject into the next prompt as context */
  inject?: string;
  /** If true, the command consumed the input — don't send to LLM */
  handled?: boolean;
}
```

### InputTransformEvent & Result

```typescript
/** Input event — fired when user submits a prompt, before processing */
export interface InputTransformEvent {
  /** The raw user input text */
  text: string;
  /** Whether this is a slash command (starts with /) */
  isCommand: boolean;
}

/** Input transform result */
export interface InputTransformResult {
  /** What to do with the input */
  action: 'continue' | 'transform' | 'handled' | 'block';
  /** Transformed text (only for action: 'transform') */
  text?: string;
  /** Block reason (only for action: 'block') */
  reason?: string;
  /** Injected context (for action: 'handled' — displayed but not sent to LLM) */
  response?: string;
}
```

### Update EVENT_TIERS

```typescript
export const EVENT_TIERS: Record<string, ExtensionTier> = {
  // Tier 1 (universal)
  context_inject: 'universal',
  tool_call: 'universal',
  agent_end: 'universal',
  session_start: 'universal',
  session_end: 'universal',
  // Tier 2 (rich)
  context_modify: 'rich',
  tool_result: 'rich',
  turn_start: 'rich',
  turn_end: 'rich',
  // NEW — Tier 1
  input: 'universal',
};
```

### Update ADAPTER_CAPABILITIES

```typescript
export const ADAPTER_CAPABILITIES: Record<string, Set<string>> = {
  'pi':          new Set([..., 'input']),
  'claude-code': new Set([..., 'input']),
  'openclaw':    new Set([...]),  // no input support
  'cursor':      new Set(['context_inject']),
  'copilot':     new Set(['context_inject']),
};
```

### Update LoadedExtension

```typescript
export interface LoadedExtension {
  path: string;
  handlers: Map<string, Function[]>;
  tools: Map<string, ToolDefinition>;
  commands: Map<string, CommandDefinition>;  // NEW
  tiers: Set<ExtensionTier>;
}
```

### Update ExtensionDiagnostic

```typescript
export interface ExtensionDiagnostic {
  path: string;
  handlerCounts: Record<string, number>;
  toolNames: string[];
  commandNames: string[];  // NEW
  tiers: ExtensionTier[];
}
```

---

## Phase 1 — ExtensionAPI + Loader updates

### DotAiExtensionAPI additions

**File:** `packages/core/src/extension-api.ts`

```typescript
export interface DotAiExtensionAPI {
  // ... existing events ...

  // NEW — Input transformation
  on(event: 'input', handler: (e: InputTransformEvent) => Promise<InputTransformResult | void>): void;

  // ... existing registerTool ...

  // NEW — Commands
  registerCommand(command: CommandDefinition): void;

  // ... existing providers, events ...
}
```

### Extension Loader updates

**File:** `packages/core/src/extension-loader.ts`

- Update `createCollectorAPI()` to support `registerCommand()`
- Collect commands into `extension.commands` Map
- Track 'input' event tier

---

## Phase 2 — ExtensionRunner + Runtime updates

### ExtensionRunner additions

**File:** `packages/core/src/extension-runner.ts`

```typescript
export class ExtensionRunner {
  // ... existing ...

  /** Get all registered commands across extensions */
  get commands(): CommandDefinition[]

  /** Fire input event — returns first non-continue result */
  async fireInputTransform(event: InputTransformEvent): Promise<InputTransformResult | null>
}
```

`fireInputTransform()` works like `fireUntilBlocked()`:
- Iterate extensions, call `input` handlers
- First handler returning `action !== 'continue'` wins
- If all return 'continue' or void → return null (proceed normally)

### DotAiRuntime additions

**File:** `packages/core/src/runtime.ts`

```typescript
export class DotAiRuntime {
  // ... existing ...

  /** Get registered commands */
  get commands(): CommandDefinition[]

  /**
   * Process user input before prompt pipeline.
   * Handles slash commands and input transforms.
   * Returns null if input should proceed to processPrompt() normally.
   */
  async processInput(text: string): Promise<InputProcessResult>
}

export interface InputProcessResult {
  /** Whether the input was consumed (command or handled by extension) */
  handled: boolean;
  /** Text response to show the user */
  response?: string;
  /** Transformed text to use instead of original */
  transformedText?: string;
  /** Context to inject alongside the prompt */
  inject?: string;
}
```

`processInput()` flow:
1. Check if text starts with `/` → look up registered commands
2. If command found → parse args → execute → return result
3. If not a command → fire `input` event to extensions
4. If extension handles → return result
5. Otherwise → return `{ handled: false }`

---

## Phase 3 — Adapter wiring

### Pi adapter

**File:** `packages/adapter-pi/src/index.ts`

```typescript
// In session_start handler:
for (const cmd of runtime.commands) {
  pi.registerCommand(cmd.name, {
    description: cmd.description,
    handler: async (args, ctx) => {
      const result = await cmd.execute(parseArgs(args, cmd.parameters), {
        workspaceRoot: process.cwd(),
        rawArgs: args,
        providers: runtime.extensionAPI.providers,
        events: runtime.extensionAPI.events,
      });
      // Handle result...
    },
    getArgumentCompletions: cmd.parameters?.[0]?.completions,
  });
}

// In input handler:
pi.on('input', async (event, ctx) => {
  if (!runtime) return;
  const result = await runtime.processInput(event.text);
  if (result.handled) {
    return { action: 'handled' };
  }
  if (result.transformedText) {
    return { action: 'transform', text: result.transformedText };
  }
  return { action: 'continue' };
});
```

### Claude Code adapter

**File:** `packages/adapter-claude/src/hook.ts`

```typescript
// In handlePromptSubmit:
async function handlePromptSubmit(event) {
  const prompt = event.prompt ?? event.content ?? '';
  if (!prompt) return runtime;

  // NEW: process input first (commands + input transforms)
  const inputResult = await runtime.processInput(prompt);
  if (inputResult.handled) {
    // Command was executed — return response directly
    if (inputResult.response) {
      process.stdout.write(JSON.stringify({ result: inputResult.response }));
    }
    return runtime;
  }

  // Use transformed text if available
  const effectivePrompt = inputResult.transformedText ?? prompt;
  const { formatted } = await runtime.processPrompt(effectivePrompt);

  // Append any inject from input transform
  const finalFormatted = inputResult.inject
    ? formatted + '\n\n---\n\n' + inputResult.inject
    : formatted;

  if (finalFormatted) {
    process.stdout.write(JSON.stringify({ result: finalFormatted }));
  }
  return runtime;
}
```

### OpenClaw adapter

OpenClaw doesn't support input transformation. Commands could be registered as OpenClaw plugin commands if their API supports it. Otherwise, commands are available via capabilities only.

---

## Phase 4 — Sample extensions + tests

### Sample: `/deploy` command extension

**File:** `packages/core/src/__tests__/fixtures/extensions/deploy-command.js`

```javascript
module.exports = function(api) {
  api.registerCommand({
    name: 'deploy',
    description: 'Deploy the current project',
    parameters: [
      { name: 'env', description: 'Target environment', required: true },
    ],
    async execute(args, ctx) {
      const env = args.env ?? 'staging';
      return {
        text: `Deploying to ${env}...`,
        inject: `The user has requested deployment to ${env}. Help them verify the deployment.`,
      };
    },
  });
};
```

### Sample: Input guard extension

**File:** `packages/core/src/__tests__/fixtures/extensions/input-guard.js`

```javascript
module.exports = function(api) {
  api.on('input', async (event) => {
    // Block prompts asking to delete production data
    if (/delete.*production/i.test(event.text)) {
      return {
        action: 'block',
        reason: 'Blocked: prompts requesting production data deletion are not allowed.',
      };
    }
    // Auto-append context for deployment-related prompts
    if (/deploy|release|ship/i.test(event.text)) {
      return {
        action: 'transform',
        text: event.text + '\n\n[Note: Always run tests before deploying]',
      };
    }
    return { action: 'continue' };
  });
};
```

### Tests

- Command registered → appears in `runner.commands`
- Command executed → returns result
- Input event fires → first non-continue wins
- `processInput('/deploy staging')` → command executes
- `processInput('normal prompt')` → returns `{ handled: false }`
- Input guard blocks dangerous prompts
- Input guard transforms prompts
- Commands appear in runtime diagnostics
- Adapter capability matrix includes `input` for Pi and Claude Code

---

## Phase 5 — Prompt templates wiring

Connect the existing `PromptProvider` to the command system:

- At boot, load prompts from PromptProvider
- Each prompt becomes a command: `/prompt-name` → loads template, substitutes args
- Templates with `$args` prompt the user for values (or take from command args)
- This bridges Pi's `/name` template expansion and Claude Code's skill-based slash commands

```typescript
// In runtime.boot():
if (this._providers?.prompts) {
  const templates = await this._providers.prompts.list();
  for (const template of templates) {
    // Register each prompt template as a command
    this._promptCommands.set(template.name, {
      name: template.name,
      description: template.description ?? `Prompt template: ${template.name}`,
      parameters: template.args?.map(a => ({ name: a, description: a, required: true })),
      async execute(args, ctx) {
        let content = await ctx.providers.prompts?.load(template.name);
        // Substitute $args
        if (content && args) {
          for (const [key, value] of Object.entries(args)) {
            content = content.replace(new RegExp(`\\$${key}`, 'g'), value);
          }
        }
        return { inject: content ?? '', handled: false };
      },
    });
  }
}
```

---

## Updated ADAPTER_CAPABILITIES

```typescript
export const ADAPTER_CAPABILITIES: Record<string, Set<string>> = {
  'pi': new Set([
    'context_inject', 'context_modify', 'tool_call', 'tool_result',
    'agent_end', 'session_start', 'session_end', 'turn_start', 'turn_end',
    'input', 'commands',
  ]),
  'claude-code': new Set([
    'context_inject', 'tool_call', 'agent_end', 'session_start',
    'input', 'commands',
  ]),
  'openclaw': new Set([
    'context_inject', 'agent_end', 'session_start',
    'commands',  // via plugin commands
  ]),
  'cursor': new Set(['context_inject']),
  'copilot': new Set(['context_inject']),
};
```

---

## Implementation Order

```
Phase 0 (types)         ██░░░░░░░░  ~1h
Phase 1 (API + loader)  ██░░░░░░░░  ~1h
Phase 2 (runner + RT)   ███░░░░░░░  ~2h
Phase 3 (adapters)      ████░░░░░░  ~3h
Phase 4 (samples+tests) ███░░░░░░░  ~2h
Phase 5 (prompts)       ██░░░░░░░░  ~1h
                                    ------
                                    ~10h total
```

---

## Key Design Decisions

1. **Commands are extension-registered, not config-declared** — extensions own their commands
2. **Input transform uses first-wins** — like tool_call blocking, first handler to return non-continue wins
3. **Prompt templates auto-register as commands** — bridging prompts and commands naturally
4. **processInput() before processPrompt()** — clear separation of input processing vs context enrichment
5. **CommandContext is slim** — workspace + providers + events. No UI, no session control (adapter-specific)
6. **Adapters bridge commands to native systems** — Pi registerCommand, Claude Code hooks, OpenClaw plugin commands
7. **No breaking change** — v5.1 is additive, all v5 extensions still work
