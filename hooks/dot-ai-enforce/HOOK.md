---
name: dot-ai-enforce
description: "Injects dot-ai workspace context into every agent session at bootstrap"
metadata: { "openclaw": { "emoji": "🏗️", "events": ["agent:bootstrap"] } }
---

# dot-ai Enforce Hook

Ensures the dot-ai workspace convention is loaded at every session start.

## What It Does

1. Detects if the workspace follows the dot-ai convention (has `.ai/skills/dot-ai/`)
2. Injects critical context into `bootstrapFiles`:
   - Workspace routing rules
   - Task management convention (dot-ai-tasks)
   - Data separation rules (data/ = structured only)
3. Ensures sub-agents inherit the convention

## Why

Without this hook, the agent must "remember" to read the SKILL.md files.
This hook makes it automatic — no drift, no forgotten conventions.
