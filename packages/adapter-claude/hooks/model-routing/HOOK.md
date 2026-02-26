---
name: model-routing
description: "Enforces model selection rules for sub-agent spawns"
metadata: { "openclaw": { "emoji": "🧠", "events": ["agent:bootstrap"] } }
---

# Model Routing Hook

Injects model routing rules into every session to prevent cost waste.

## Rules Enforced

- Sub-agents: Haiku for execution, Sonnet for dev, Opus only when explicit
- Main session: auto-switch based on task phase
- Context budget: delegate aggressively above 70%
