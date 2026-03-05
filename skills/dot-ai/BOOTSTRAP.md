# dot-ai Convention -- Bootstrap (Minimal Context)

**This workspace follows the dot-ai convention.**

## How It Works

dot-ai is a **deterministic context enrichment engine**. It transforms your prompts into enriched context by matching against workspace knowledge. You don't call it directly -- it runs automatically via your agent's adapter.

## Pipeline (automatic)

1. **Boot** (once per session): load identities, build vocabulary from skill/tool labels, cache
2. **Enrich** (per prompt): extract labels from prompt, query providers in parallel (memory, skills, tools, routing)
3. **Format**: convert enriched context to markdown, inject into agent
4. **Learn** (after response): store significant outcomes in memory

## 6 Providers (configured in `.ai/dot-ai.yml`)

| Provider | Purpose |
|----------|---------|
| Memory | search + store memories (SQLite, files, custom) |
| Skills | match skills to prompt labels, lazy-load content |
| Identity | load AGENTS.md, SOUL.md, USER.md, IDENTITY.md |
| Routing | decide model tier (haiku/sonnet/opus) |
| Tasks | CRUD tasks (Cockpit API, files, custom) |
| Tools | discover external tools |

## Capabilities (interactive tools)

Agents get these tools via adapters: `memory_recall`, `memory_store`, `task_list`, `task_create`, `task_update`.

## Model Routing

- **Haiku**: file reads, data extraction, formatting
- **Sonnet**: development, research, analysis
- **Opus**: planning, architecture, orchestration only

## Sub-Skills

Core: `dot-ai-workspace-scan`, `dot-ai-project-init`, `dot-ai-tasks`, `dot-ai-audit`, `dot-ai-security`
Sync: `dot-ai-agent-sync`, `dot-ai-skill-sync`, `dot-ai-backlog-sync`, `dot-ai-memory-sync`, `dot-ai-tools-sync`
Architecture: `dot-ai-architecture` (full engine reference for agents)

Full reference: `.ai/skills/dot-ai/SKILL.md`
