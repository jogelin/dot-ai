---
name: dot-ai-architecture
description: "Quick architecture reference for understanding and working with the dot-ai convention. Use when an agent needs to understand how dot-ai enriches context, what providers do, or how to create adapters/providers."
labels: [architecture, dot-ai, providers, adapters, capabilities, hooks]
triggers: [manual]
enabled: true
---

# dot-ai Architecture -- Quick Reference

## What is dot-ai?

A **deterministic context enrichment engine** for AI workspaces. It transforms raw prompts into enriched context by matching against workspace knowledge (skills, memory, identities, tools, routing).

**dot-ai is NOT an agent.** It's a library that agents consume via adapters.

## Core Flow

```
prompt -> extractLabels(vocabulary) -> query providers in parallel -> EnrichedContext -> formatContext -> markdown
```

Three phases:
1. **boot()** -- once per session: load identities, build vocabulary, cache
2. **enrich(prompt)** -- per prompt: extract labels, query providers, return EnrichedContext
3. **learn(response)** -- after response: store in memory

## Quick Integration

```typescript
import { DotAiRuntime } from '@dot-ai/core';
const runtime = new DotAiRuntime({ workspaceRoot: '/path' });
await runtime.boot();
const { formatted, capabilities } = await runtime.processPrompt(prompt);
```

## 6 Provider Contracts

| Contract | What it does |
|----------|-------------|
| MemoryProvider | search + store memory entries |
| SkillProvider | list, match, load skills |
| IdentityProvider | load identity documents |
| RoutingProvider | decide model (haiku/sonnet/opus) |
| TaskProvider | CRUD tasks |
| ToolProvider | discover + match tools |

## Key Concepts

- **Labels**: deterministic word-boundary matching (no LLM)
- **Vocabulary**: all skill + tool labels, built at boot
- **Capabilities**: interactive tools (memory_recall, task_list, etc.) defined in core
- **Hooks**: 4 pipeline events (after_boot/enrich/format/learn)
- **Token Budget**: auto-trim skills/memories to fit budget

-> Full reference: `SKILL.md`
