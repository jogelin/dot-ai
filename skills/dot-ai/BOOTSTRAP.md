# dot-ai Convention — Bootstrap (Minimal Context)

**This workspace follows the dot-ai convention.**

## Boot Sequence

1. **Core context**: AGENTS.md -> SOUL.md -> USER.md -> IDENTITY.md -> TOOLS.md
2. **Session context**: memory/YYYY-MM-DD.md (today + yesterday), projects-index.md
3. **Discovery**: scan projects, index skills, ready to route

## Task Management

Use `dot-ai-tasks` sub-skill. Provider: Cockpit API (`POST localhost:3010/api/tasks`).

## Routing

Every request routes through `memory/projects-index.md`:
1. Match prompt -> project
2. Load project `.ai/AGENT.md` + `TOOLS.md`
3. Check matching skills
4. Execute with loaded context

## Model Routing

- **Haiku**: file reads, data extraction, formatting
- **Sonnet**: development, research, analysis
- **Opus**: planning, architecture, orchestration only

## Sub-Skills

Core: `dot-ai-workspace-scan`, `dot-ai-project-init`, `dot-ai-tasks`, `dot-ai-audit`, `dot-ai-security`
Sync: `dot-ai-agent-sync`, `dot-ai-skill-sync`, `dot-ai-backlog-sync`, `dot-ai-memory-sync`, `dot-ai-tools-sync`

Full reference: `.ai/skills/dot-ai/SKILL.md`
