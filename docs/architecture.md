# dot-ai v7 Architecture

## Overview

dot-ai v7 = extensions + runtime + adapters

Everything is an extension. There are no providers, no hooks, no tiers.

```
Adapter (Claude Code / Pi / OpenClaw / Sync)
  |
  v
DotAiRuntime
  +-- Extensions (the ONLY way to contribute context)
  |     +-- ExtensionLoader (discover + load via jiti)
  |     +-- ExtensionRunner (fire events, collect results)
  +-- Vocabulary (labels from skills, identities, extensions)
  +-- Capabilities (tools from extensions)
```

## Packages

| Package | Purpose |
|---------|---------|
| `@dot-ai/core` | Runtime, extension loader/runner, format utilities, types |
| `@dot-ai/adapter-claude` | Claude Code hooks integration |
| `@dot-ai/adapter-openclaw` | OpenClaw plugin |
| `@dot-ai/adapter-pi` | Pi coding agent |
| `@dot-ai/adapter-sync` | Sync to `.cursorrules`, `copilot-instructions.md` |
| `@dot-ai/ext-file-memory` | File-based memory extension |
| `@dot-ai/ext-sqlite-memory` | SQLite memory extension |
| `@dot-ai/ext-file-skills` | File-based skills extension |
| `@dot-ai/ext-file-identity` | File-based identity extension |
| `@dot-ai/ext-file-tools` | File-based tools extension |
| `@dot-ai/ext-file-prompts` | File-based prompts extension |
| `@dot-ai/ext-rules-routing` | Rules-based routing extension |
| `@dot-ai/cli` | CLI (`init`, `boot`, `trace`, `tools`, `commands`) |

## Configuration

`settings.json` in the `.ai/` directory:

```json
{
  "extensions": {
    "paths": ["./custom-extensions"],
    "packages": ["my-dot-ai-extension"]
  }
}
```

## DotAiRuntime

`DotAiRuntime` is the main entry point for adapters. It orchestrates the full lifecycle: boot, processPrompt, fireToolCall, shutdown.

```typescript
const runtime = new DotAiRuntime({
  workspaceRoot: '/path/to/project',
  logger: new JsonFileLogger('/path/to/log'),
});

// Boot once per session
await runtime.boot();

// Process each prompt
const { sections, labels, routing } = await runtime.processPrompt(userPrompt);
const formatted = formatSections(sections);
// inject formatted into agent context

// On agent response
await runtime.fire('agent_end', { response });

// End of session
await runtime.shutdown();
```

### RuntimeOptions

| Option | Type | Description |
|--------|------|-------------|
| `workspaceRoot` | string | Root directory containing `.ai/` |
| `logger` | Logger | Optional structured logger |
| `tokenBudget` | number | Token budget for formatted output |

## Extension System

Extensions are the only mechanism for contributing context, tools, labels, and behavior. Each extension is a factory function that receives an `ExtensionAPI` and registers resources at boot time and event handlers for runtime events.

### Extension API

```typescript
export default async function(api: ExtensionAPI) {
  // Boot-time registration
  api.registerSkill(skill);          // auto-contributes labels
  api.registerIdentity(identity);
  api.contributeLabels(['label1']);
  api.registerTool(toolDef);
  api.registerCommand(cmdDef);

  // Event handlers
  api.on('context_enrich', async (event) => {
    return { sections: [...] };
  });
  api.on('tool_call', async (event) => { ... });
  api.on('agent_end', async (event) => { ... });
  api.on('route', async (event) => { ... });
  api.on('label_extract', async (event) => { ... });
}
```

### Loading Flow

1. `discoverExtensions()` scans `.ai/extensions/` directories, config paths, and npm packages
2. `loadExtensions()` imports each file via jiti (or native import fallback), calls the default export with a collector API
3. The factory registers event handlers, tools, skills, identities, and labels on the collector API
4. The collector builds a `LoadedExtension` with handler maps and tool maps
5. `ExtensionRunner` wraps all loaded extensions for event dispatch
6. The runtime fires events through the runner during each pipeline phase

## Event System

Five emission patterns, each with distinct semantics:

| Pattern | Method | Used For |
|---------|--------|----------|
| fire | `fire()` | Broadcast: `session_start`, `session_end`, `agent_start`, `agent_end`, `session_compact` |
| fireCollectSections | `fireCollectSections()` | `context_enrich` -- collects `Section[]` from all handlers |
| fireFirstResult | `fireFirstResult()` | `route` -- first handler wins |
| fireChainTransform | `fireChainTransform()` | `label_extract`, `input`, `tool_result` -- each handler transforms the data |
| fireUntilBlocked | `fireUntilBlocked()` | `tool_call` -- stops at first block |

## Sections

Sections are the universal unit of context. Every piece of information injected into the agent prompt is a section.

```typescript
interface Section {
  id: string;
  title: string;
  content: string;
  priority: number;
  source: string;
  trimStrategy?: 'never' | 'truncate' | 'drop';
}
```

Priority conventions:

| Priority | Usage |
|----------|-------|
| 100 | Identity |
| 95 | System (core `dot-ai:system` section) |
| 80 | Memory |
| 60 | Skills |
| 50 | Tasks |
| 40 | Tools |

Adapters call `formatSections(sections)` to produce the final markdown string injected into the agent context.

## Pipeline Flow

### Boot Phase (once per session)

```
runtime.boot()
  -> loadConfig(.ai/settings.json)
  -> discoverExtensions()
  -> loadExtensions()
       each factory calls registerSkill / registerIdentity / contributeLabels / registerTool
  -> buildVocabulary from runner.vocabularyLabels
  -> buildCapabilities from runner.tools
  -> fire('session_start')
```

### Prompt Phase (per prompt)

```
runtime.processPrompt(prompt)
  -> fireChainTransform('label_extract', { prompt, vocabulary, labels: [] })
  -> fireCollectSections('context_enrich', { prompt, labels })
  -> add core system section (id: 'dot-ai:system', priority: 95)
  -> fireFirstResult('route', { prompt, labels })
  -> return { sections, labels, routing }
```

### Tool Call Phase (adapter-driven)

```
runtime.fireToolCall({ tool, input })
  -> ExtensionRunner.fireUntilBlocked('tool_call', event)
       iterate extensions in load order
       first handler returning { decision: 'block' } stops iteration
       return blocking result, or null if all allow
```

### Agent Response Phase

```
await runtime.fire('agent_end', { response })
  -> broadcasts to all extensions
  -> memory extensions store the response
```

### Shutdown Phase

```
runtime.shutdown()
  -> fire('session_end')
  -> flush logger buffers
```

## Adapter Pattern

Adapters wire the runtime into a specific AI agent. The pattern is the same across all adapters:

```typescript
const runtime = new DotAiRuntime({ workspaceRoot });
await runtime.boot();

// On each prompt
const { sections, labels, routing } = await runtime.processPrompt(prompt);
const formatted = formatSections(sections);
// inject `formatted` into agent system prompt

// On agent response
await runtime.fire('agent_end', { response });

// On session end
await runtime.shutdown();
```

## Labels

Labels are boolean tags extracted from the prompt against a known vocabulary. They drive skill matching, tool matching, routing decisions, and identity loading.

The vocabulary is built at boot from skills (via `registerSkill()`), identities (via `registerIdentity()`), and explicit contributions (via `contributeLabels()`).

Labels have a `name` and a `source` indicating which extension produced them.

## Diagnostics

`runtime.diagnostics` returns:

```typescript
{
  extensions: ExtensionDiagnostic[],
  vocabularySize: number,
  capabilityCount: number,
  skillCount: number,
  identityCount: number,
}
```
