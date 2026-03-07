# Writing dot-ai Extensions

Extensions are the primary way to customize dot-ai behavior. They enrich context with sections, gate tool calls, register skills and identities, route models, and expose custom tools and commands.

## Quick Start

Create a file at `.ai/extensions/my-extension.ts`:

```typescript
import type { ExtensionAPI } from '@dot-ai/core';

export default async function(api: ExtensionAPI) {
  // Add context sections before every prompt
  api.on('context_enrich', async (event) => {
    return {
      sections: [{
        id: 'my-ext:reminder',
        title: 'Testing Reminder',
        content: 'Always write tests!',
        priority: 50,
        source: 'my-extension',
        trimStrategy: 'drop',
      }],
    };
  });

  // Block writes to sensitive files
  api.on('tool_call', async (event) => {
    if (event.tool === 'Write' && event.input.file_path?.toString().endsWith('.env')) {
      return { decision: 'block', reason: 'Cannot write to .env files' };
    }
  });

  // Register a custom tool
  api.registerTool({
    name: 'my_tool',
    description: 'Does something useful',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async execute(input) {
      return { content: `Result for: ${input.query}` };
    },
  });
}
```

## Extension API

The factory function receives an `ExtensionAPI` object with two categories of methods: **boot-time registration** (called during extension loading) and **event handlers** (called during runtime).

### Boot-Time Registration

Register resources that become available to the runtime immediately after boot:

```typescript
export default async function(api: ExtensionAPI) {
  // Register a skill (matched by labels during context enrichment)
  api.registerSkill({
    name: 'sql-guidelines',
    description: 'SQL best practices',
    labels: ['database', 'sql'],
    triggers: ['auto'],            // optional: "always", "auto", or pattern strings
    content: 'Always use parameterized queries...',
  });

  // Register an identity document (included in system prompt)
  api.registerIdentity({
    type: 'soul',
    content: 'You are a careful, test-driven developer.',
    source: 'my-extension',
    priority: 90,                  // higher = earlier in prompt
    node: 'root',                  // optional: context node
  });

  // Contribute labels to the global vocabulary (for label matching)
  api.contributeLabels(['database', 'sql', 'migration']);

  // Register a tool (see Tool Registration section below)
  api.registerTool({ name, description, parameters, execute });

  // Register a slash command
  api.registerCommand({
    name: 'my-command',
    description: 'Does something',
    async execute(args, ctx) {
      return { output: 'Done!' };
    },
  });
}
```

### Event Handlers

Subscribe to runtime events with `api.on(event, handler)`. Every handler receives an event payload as the first argument and an `ExtensionContext` as the second:

```typescript
interface ExtensionContext {
  workspaceRoot: string;
  labels: Label[];
  events: EventBus;       // inter-extension communication
  agent?: {               // adapter-provided, may be undefined
    abort(): void;
    getContextUsage(): { tokens: number; percent: number } | undefined;
    getSystemPrompt(): string;
  };
}
```

## Events Reference

| Event | Pattern | Return Type | Description |
|-------|---------|-------------|-------------|
| `context_enrich` | collectSections | `{ sections?, systemPrompt? }` | Add sections to context |
| `tool_call` | untilBlocked | `{ decision: 'block', reason }` | Gate tool calls |
| `agent_end` | broadcast | void | React to agent response |
| `route` | firstResult | `{ model, reason }` | Model routing |
| `label_extract` | chainTransform | `Label[]` | Transform labels |
| `tool_result` | chainTransform | Modified event | Transform tool results |
| `input` | chainTransform | `{ input?, consumed? }` | Process user input |
| `session_start` | broadcast | void | Session started |
| `session_end` | broadcast | void | Session ending |
| `session_compact` | broadcast | void | Context compaction |
| `turn_start` | broadcast | void | Turn started |
| `turn_end` | broadcast | void | Turn ended |
| `agent_start` | broadcast | void | Agent started |

**Firing patterns:**

- **broadcast** -- all handlers run, return values are ignored.
- **collectSections** -- all handlers run, returned sections are merged into one list.
- **untilBlocked** -- handlers run in order; stops at the first `{ decision: 'block' }`.
- **firstResult** -- handlers run in order; stops at the first non-void return.
- **chainTransform** -- handlers run in order; each receives the previous handler's output.

## Event Details

### context_enrich

The primary way to inject context into the agent prompt. Handlers return sections that the formatter assembles by priority. Replaces the old `context_inject` event.

```typescript
api.on('context_enrich', async (event, ctx) => {
  // event.prompt  -- the raw user prompt
  // event.labels  -- matched Label[] for this turn

  if (event.labels.some(l => l.name === 'database')) {
    return {
      sections: [{
        id: 'my-ext:db-guidelines',
        title: 'Database Guidelines',
        content: 'Always use parameterized queries.\nNever use string concatenation for SQL.',
        priority: 60,
        source: 'my-extension',
        trimStrategy: 'truncate',
      }],
    };
  }
});
```

You can also provide a system prompt override (for adapters that support it):

```typescript
api.on('context_enrich', async (event, ctx) => {
  return {
    sections: [/* ... */],
    systemPrompt: 'You are a database expert.',
  };
});
```

### Section Type

```typescript
interface Section {
  id?: string;           // unique identifier (optional; anonymous sections allowed)
  title: string;         // section heading
  content: string;       // markdown content
  priority: number;      // ordering and trim precedence (higher = more important)
  source: string;        // which extension produced this
  trimStrategy?: 'never' | 'truncate' | 'drop';  // behavior when token budget exceeded
}
```

**Priority guidelines:**

| Range | Typical Use |
|-------|-------------|
| 100 | Identity documents |
| 95 | System-level context |
| 80 | Memory/recall |
| 60 | Skills |
| 50 | Tasks |
| 40 | Tools |
| 30 | Routing hints |

**Trim strategies:**

- `never` -- never removed, even under token pressure (use sparingly).
- `truncate` -- content shortened but section kept.
- `drop` -- section removed entirely (default).

### tool_call

Fired before a tool executes. The runner stops at the first handler returning `{ decision: 'block' }`. If no handler blocks, the tool proceeds.

```typescript
api.on('tool_call', async (event, ctx) => {
  // event.tool  -- tool name (e.g., 'Write', 'Bash', 'memory_store')
  // event.input -- tool parameters as Record<string, unknown>

  if (event.tool === 'Bash' && event.input.command?.toString().includes('rm -rf')) {
    return { decision: 'block', reason: 'Destructive commands are not allowed' };
  }
});
```

### agent_end

Fired after the agent produces a response. Broadcast pattern -- all handlers run.

```typescript
api.on('agent_end', async (event, ctx) => {
  // event.response -- the full agent response text
  console.log(`Agent responded with ${event.response.length} characters`);
});
```

### route

Fired to determine model selection. First handler to return a result wins.

```typescript
api.on('route', async (event, ctx) => {
  // event.labels -- matched labels for this turn
  if (event.labels.some(l => l.name === 'architecture')) {
    return { model: 'opus', reason: 'Complex architectural question' };
  }
});
```

### label_extract

Chain-transform pattern. Each handler receives the current labels and vocabulary, and can return a modified labels array.

```typescript
api.on('label_extract', async (event, ctx) => {
  // event.prompt     -- user prompt text
  // event.vocabulary -- known label names from all extensions
  // event.labels     -- current Label[] (from previous handlers)

  if (event.prompt.toLowerCase().includes('migration')) {
    return [...event.labels, { name: 'database', source: 'my-extension' }];
  }
});
```

### input

Chain-transform for user input. Can rewrite the input or consume it entirely (e.g., to handle a command).

```typescript
api.on('input', async (event, ctx) => {
  // event.input -- raw user input string

  if (event.input.startsWith('/secret ')) {
    return { consumed: true };  // swallow the input
  }

  // Or transform it
  return { input: event.input.replace(/TODO/g, 'ACTION ITEM') };
});
```

### tool_result

Chain-transform fired after tool execution. Can modify the result before it reaches the agent.

```typescript
api.on('tool_result', async (event, ctx) => {
  // event.tool    -- tool name
  // event.result  -- { content: string }
  // event.isError -- boolean
});
```

### session_start / session_end

Lifecycle events fired after `runtime.boot()` completes and before `runtime.shutdown()` flushes.

```typescript
api.on('session_start', async (event, ctx) => {
  console.log('Session started');
});

api.on('session_end', async (event, ctx) => {
  console.log('Session ending, cleaning up...');
});
```

### session_compact

Fired when the agent's context window is compacted (summarized to free space).

```typescript
api.on('session_compact', async (event, ctx) => {
  console.log('Context was compacted');
});
```

### turn_start / turn_end / agent_start

Fine-grained lifecycle events for tracking turn and agent boundaries. Broadcast pattern, no payload.

## Tool Registration

Register custom tools that agents can call. Extension tools are automatically converted to capabilities and exposed to the agent alongside built-in capabilities.

```typescript
api.registerTool({
  name: 'search_docs',
  description: 'Search project documentation',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  },
  promptSnippet: 'Use search_docs to find relevant documentation before answering questions.',
  promptGuidelines: 'Always search docs before making assumptions about the project.',
  async execute(input, ctx) {
    return { content: `Found: ...`, details: { count: 5 } };
  },
});
```

### ToolDefinition Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique tool name |
| `description` | string | yes | Shown to the agent |
| `parameters` | JSON Schema object | yes | Input schema |
| `execute` | `(input, ctx?) => Promise<{ content, details?, isError? }>` | yes | Implementation |
| `promptSnippet` | string | no | Injected into system prompt when tool is active |
| `promptGuidelines` | string | no | Usage guidelines for the LLM |

If two extensions register tools with the same name, the first one wins and a warning is logged.

## Command Registration

Register slash commands that users can invoke directly.

```typescript
api.registerCommand({
  name: 'deploy',
  description: 'Deploy the current project',
  parameters: [
    { name: 'environment', description: 'Target environment', required: true },
  ],
  async execute(args, ctx) {
    return { output: `Deployed to ${args.environment}` };
  },
  completions(prefix) {
    return ['staging', 'production'].filter(e => e.startsWith(prefix));
  },
});
```

## Inter-Extension Communication

Extensions can communicate via the shared event bus available on `api.events`:

```typescript
export default async function(api: ExtensionAPI) {
  // Listen for events from other extensions
  api.events.on('custom:data-ready', (data) => {
    console.log('Data received from another extension:', data);
  });

  // Emit events for other extensions
  api.events.emit('custom:data-ready', { key: 'value' });
}
```

The event bus is in-memory only (no persistence) and errors in handlers are silently caught.

## Adapter Support Matrix

Not all adapters fire all events. Extensions using unsupported events will not break -- those handlers simply never fire.

| Adapter | context_enrich | tool_call | agent_end | route | session_compact |
|---------|:-:|:-:|:-:|:-:|:-:|
| Pi | yes | yes | yes | yes | -- |
| Claude Code | yes | yes | yes | yes | yes |
| OpenClaw | yes | -- | yes | yes | -- |
| Sync | yes | -- | -- | -- | -- |

## Distribution

### As an npm package

Add a `dot-ai` field to your `package.json`:

```json
{
  "name": "my-dot-ai-extension",
  "dot-ai": {
    "extensions": ["src/index.ts"]
  }
}
```

Then register the package in your project's `settings.json`:

```json
{
  "extensions": {
    "packages": ["my-dot-ai-extension"]
  }
}
```

Install: `dot-ai install my-dot-ai-extension`

### As local files

Place `.ts` or `.js` files in `.ai/extensions/` (project-level) or `~/.ai/extensions/` (global).

You can also specify additional paths in `settings.json`:

```json
{
  "extensions": {
    "paths": ["./custom/extensions"]
  }
}
```

### Discovery order

1. `.ai/extensions/` in workspace root (project-level)
2. `~/.ai/extensions/` in home directory (global)
3. Paths from `extensions.paths` in config
4. npm packages from `extensions.packages` in config

For directories within extension folders, the loader checks for `index.ts`/`index.js` or a `package.json` with a `dot-ai.extensions` field.

## Loading

Extensions are loaded via [jiti](https://github.com/unjs/jiti) which supports TypeScript natively without a build step. If jiti is not installed, the loader falls back to native `import()` (requires pre-compiled JS).

Each extension file must export a default function (the factory). The factory receives an `ExtensionAPI` and registers handlers, tools, commands, skills, and identities on it:

```typescript
// ES module default export
export default async function(api: ExtensionAPI) { /* ... */ };

// CommonJS style also works
module.exports = async function(api) { /* ... */ };
```

The factory can be synchronous or asynchronous.

## Error Handling

Extensions are isolated from each other and from the core runtime:

- If an extension factory throws during loading, it is skipped and a warning is logged.
- If a handler throws during event firing, the error is caught, logged, and the next handler runs.
- Tool and command name conflicts produce a warning; the first registration wins.

Extensions never crash the runtime.

## Configuration Reference

```json
// .ai/settings.json
{
  "extensions": {
    "paths": ["./my-extensions"],
    "packages": ["my-dot-ai-extension"]
  }
}
```

Extensions can access their own configuration via `api.config`, which is populated from extension-specific config files or environment variables.

## Complete Example

A full-featured extension demonstrating boot-time registration and event handling:

```typescript
import type { ExtensionAPI } from '@dot-ai/core';

export default async function(api: ExtensionAPI) {
  // ── Boot-time registration ──

  api.registerIdentity({
    type: 'soul',
    content: 'You are a security-conscious developer who follows OWASP guidelines.',
    source: 'security-ext',
    priority: 90,
  });

  api.registerSkill({
    name: 'auth-patterns',
    description: 'Authentication and authorization patterns',
    labels: ['auth', 'security', 'login'],
    content: '## Auth Guidelines\n- Use bcrypt for password hashing\n- JWT tokens expire in 1 hour\n- Always validate CSRF tokens',
  });

  api.contributeLabels(['auth', 'security', 'login', 'csrf', 'xss']);

  api.registerTool({
    name: 'check_vulnerabilities',
    description: 'Scan a file for common security vulnerabilities',
    parameters: {
      type: 'object',
      properties: { file: { type: 'string' } },
      required: ['file'],
    },
    async execute(input) {
      // ... scan logic
      return { content: 'No vulnerabilities found.' };
    },
  });

  api.registerCommand({
    name: 'audit',
    description: 'Run a security audit',
    async execute(args, ctx) {
      return { output: 'Audit complete. 0 issues found.' };
    },
  });

  // ── Event handlers ──

  api.on('context_enrich', async (event, ctx) => {
    if (event.labels.some(l => l.name === 'security')) {
      return {
        sections: [{
          id: 'security-ext:guidelines',
          title: 'Security Guidelines',
          content: 'Follow OWASP Top 10. Validate all inputs. Use parameterized queries.',
          priority: 70,
          source: 'security-ext',
          trimStrategy: 'truncate',
        }],
      };
    }
  });

  api.on('tool_call', async (event, ctx) => {
    if (event.tool === 'Bash' && event.input.command?.toString().includes('curl')) {
      const url = event.input.command.toString();
      if (url.includes('http://')) {
        return { decision: 'block', reason: 'Use HTTPS, not HTTP' };
      }
    }
  });

  api.on('route', async (event, ctx) => {
    if (event.labels.some(l => l.name === 'security')) {
      return { model: 'opus', reason: 'Security-sensitive task requires careful analysis' };
    }
  });

  api.on('agent_end', async (event, ctx) => {
    // Log responses for audit trail
    console.log(`[security-ext] Agent response: ${event.response.length} chars`);
  });
}
```
