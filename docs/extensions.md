# Writing dot-ai Extensions

Extensions are the primary way to customize dot-ai behavior. They can intercept events, inject context, block tool calls, and register new tools.

## Quick Start

Create a file at `.ai/extensions/my-extension.ts`:

```typescript
import type { DotAiExtensionAPI } from '@dot-ai/core';

export default function(api: DotAiExtensionAPI) {
  // Inject context before every prompt
  api.on('context_inject', async (event) => {
    return { inject: '> Remember: always write tests!' };
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

## Event Tiers

### Tier 1 -- Universal (all agents)

| Event | When | Return |
|-------|------|--------|
| `context_inject` | Before each prompt | `{ inject?: string }` |
| `tool_call` | Before tool execution | `{ decision?: 'allow'\|'block', reason?: string }` |
| `agent_end` | After agent response | void |
| `session_start` | Session begins | void |
| `session_end` | Session ends | void |

### Tier 2 -- Rich (pi, future agents)

| Event | When | Return |
|-------|------|--------|
| `context_modify` | Before prompt, with messages | `{ messages?: Message[], inject?: string }` |
| `tool_result` | After tool execution | void |
| `turn_start` | Before each turn | void |
| `turn_end` | After each turn | void |

**Note:** Tier 2 events are silently ignored by adapters that don't support them (e.g., Claude Code, Cursor). Extensions using tier 2 events will still work -- those events just won't fire.

## Event Details

### context_inject

Fired during `processPrompt()`, after the enrich and format phases. Receives the raw prompt text and extracted labels. Return an `inject` string to append it to the formatted context.

```typescript
api.on('context_inject', async (event) => {
  // event.prompt  — the raw user prompt
  // event.labels  — extracted Label[] (name + source)
  // event.usage?  — { inputTokens, contextWindow } (if adapter provides it)

  if (event.labels.some(l => l.name === 'database')) {
    return { inject: '> Always use parameterized queries.' };
  }
});
```

### tool_call

Fired before a tool executes. The `ExtensionRunner.fireUntilBlocked()` method stops at the first handler returning `{ decision: 'block' }`. If no handler blocks, the tool proceeds.

```typescript
api.on('tool_call', async (event) => {
  // event.tool  — tool name (e.g., 'Write', 'Bash', 'memory_store')
  // event.input — tool parameters as Record<string, unknown>

  if (event.tool === 'Bash' && event.input.command?.toString().includes('rm -rf')) {
    return { decision: 'block', reason: 'Destructive commands are not allowed' };
  }
});
```

### agent_end

Fired after the runtime's `learn()` phase. Receives the agent's response text.

```typescript
api.on('agent_end', async (event) => {
  // event.response — the full agent response text
  console.log(`Agent responded with ${event.response.length} characters`);
});
```

### session_start / session_end

Lifecycle events fired after `runtime.boot()` completes and before `runtime.shutdown()` flushes. No data payload.

```typescript
api.on('session_start', async () => {
  console.log('Session started');
});

api.on('session_end', async () => {
  console.log('Session ending, cleaning up...');
});
```

## Accessing Providers

Extensions can access dot-ai providers for memory, skills, routing, and tasks:

```typescript
export default function(api: DotAiExtensionAPI) {
  api.on('context_inject', async (event) => {
    // Search memory
    const memories = await api.providers.memory?.search('relevant query');
    if (memories?.length) {
      return { inject: memories.map(m => m.content).join('\n') };
    }
  });
}
```

### Available Provider Methods

| Provider | Methods |
|----------|---------|
| `memory` | `search(query, labels?)`, `store(entry)` |
| `skills` | `match(labels)`, `load(name)` |
| `routing` | `route(labels)` |
| `tasks` | `list(filter?)`, `get(id)`, `create(task)`, `update(id, patch)` |

All providers are optional. If a provider is not configured in `dot-ai.yml`, the corresponding `api.providers.*` field will be `undefined`. Always use optional chaining.

## Tool Registration

Register custom tools that agents can call. Extension tools are automatically converted to capabilities and exposed to the agent alongside built-in memory/task capabilities.

```typescript
api.registerTool({
  name: 'search_docs',
  description: 'Search project documentation',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' }
    },
    required: ['query'],
  },
  promptSnippet: 'Use search_docs to find relevant documentation before answering questions.',
  promptGuidelines: 'Always search docs before making assumptions about the project.',
  async execute(input) {
    return { content: `Found: ...`, details: { count: 5 } };
  },
});
```

### ToolDefinition fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique tool name |
| `description` | string | yes | Shown to the agent |
| `parameters` | JSON Schema object | yes | Input schema |
| `execute` | `(input) => Promise<{ content, details? }>` | yes | Implementation |
| `promptSnippet` | string | no | Injected into system prompt when tool is active |
| `promptGuidelines` | string | no | Usage guidelines for the LLM |

If two extensions register tools with the same name, the first one wins and a warning is logged.

## Inter-Extension Communication

Extensions can communicate via the shared event bus:

```typescript
export default function(api: DotAiExtensionAPI) {
  api.events.on('custom:data-ready', (data) => {
    console.log('Data received from another extension:', data);
  });

  api.events.emit('custom:data-ready', { key: 'value' });
}
```

The event bus is in-memory only (no persistence) and errors in handlers are silently caught.

## Distribution

### As npm package

Add a `dot-ai` field to your package.json:

```json
{
  "name": "my-dot-ai-extension",
  "dot-ai": {
    "extensions": ["src/index.ts"]
  }
}
```

Then register the package in your project's `dot-ai.yml`:

```yaml
extensions:
  packages:
    - my-dot-ai-extension
```

Install: `dot-ai install my-dot-ai-extension`

### As local files

Place `.ts` or `.js` files in `.ai/extensions/` (project-level) or `~/.ai/extensions/` (global).

You can also specify additional paths in `dot-ai.yml`:

```yaml
extensions:
  paths:
    - ./custom/extensions
```

### Discovery order

1. `.ai/extensions/` in workspace root (project-level)
2. `~/.ai/extensions/` in home directory (global)
3. Paths from `extensions.paths` in config
4. npm packages from `extensions.packages` in config

For directories within the extension folders, the loader checks for `index.ts`/`index.js` or a `package.json` with a `dot-ai.extensions` field.

## Loading

Extensions are loaded via [jiti](https://github.com/unjs/jiti) which supports TypeScript natively without a build step. If jiti is not installed, the loader falls back to native `import()` (requires pre-compiled JS).

Each extension file must export a default function (the factory). The factory receives a `DotAiExtensionAPI` and registers handlers/tools on it:

```typescript
// CommonJS style also works
module.exports = function(api: DotAiExtensionAPI) { ... };

// Or ES module default export
export default function(api: DotAiExtensionAPI) { ... };
```

The factory can be async:

```typescript
export default async function(api: DotAiExtensionAPI) {
  const config = await loadMyConfig();
  api.on('context_inject', async () => {
    return { inject: config.banner };
  });
};
```

## Error Handling

Extensions are isolated from each other and from the core runtime:

- If an extension factory throws during loading, it is skipped and a warning is logged.
- If a handler throws during event firing, the error is caught, logged, and the next handler runs.
- Tool name conflicts produce a warning; the first registration wins.

Extensions never crash the runtime.

## Adapter Capabilities

Not all adapters support all events:

| Adapter | Supported Events |
|---------|-----------------|
| Pi | All (full fidelity) |
| Claude Code | context_inject, tool_call, agent_end, session_start |
| OpenClaw | context_inject, agent_end, session_start |
| Cursor/Copilot (sync) | context_inject |

Extensions using unsupported events will see warnings in logs but won't break.

## Configuration Reference

```yaml
# dot-ai.yml
extensions:
  paths:
    - ./my-extensions       # Additional discovery paths (resolved relative to workspace root)
  packages:
    - my-dot-ai-extension   # npm packages with dot-ai.extensions field
```
