# dot-ai-audit — Quick Reference

Weekly audit of .ai/ workspace coherence, indexes, and paths

## Triggers
- Auto: Weekly during heartbeat cycle (skips if run <6 days ago)
- Manual: "audit .ai workspace", "run dot-ai audit", "check workspace coherence"

## What It Checks
1. **Structure Convention** — Root and project .ai/ directories follow OpenClaw layout
2. **AGENT.md Files** — Frontmatter validity, staleness, auto-generated sections
3. **SKILL.md Files** — Frontmatter validity, trigger values, YAML syntax
4. **BACKLOG.md Files** — Section structure, orphan slugs/files, checkbox consistency
5. **Path References** — Broken links in .ai/ markdown files
6. **Cache Freshness** — projects-index.md, skills-index.json, activity-index.json, data-index.json

## Delegation Pattern
Orchestrates validation via specialized sub-skills:
- `dot-ai-project-init` — validates .ai/ structure convention (root + projects)
- `dot-ai-workspace-scan` — detects new/removed projects and skills
- `dot-ai-agent-sync` — validates and fixes AGENT.md files
- `dot-ai-skill-sync` — validates SKILL.md frontmatter and triggers
- `dot-ai-backlog-sync` — validates BACKLOG.md and task file consistency

This ensures single source of truth for validation rules.

## Output Format
```
🔍 dot-ai audit — YYYY-MM-DD

## Structure Convention
✅ Root .ai/ — all required files present
⚠️ van-management/.ai/ — missing memory/ (research notes in docs/ instead)

## Projects
✅ pro — AGENT.md up to date
⚠️ van-management — AGENT.md stale

## Skills Quick Reference
⚠️ Missing from reference: social-post

## Projects Index
✅ memory/projects-index.md in sync

## Broken Paths
✅ No broken paths found

## Summary
5 checks passed, 3 warnings found
```

## Auto-Fix Capability
**Auto-fixes:**
- Project data in global memory/tasks/ → move to projects/<name>/.ai/memory/
- Research/notes in wrong location → move to projects/<name>/.ai/memory/
- Stale auto-generated sections in AGENT.md → regenerate via dot-ai-agent-sync

**Proposes (requires confirmation):**
- Missing skills in Quick Reference
- Ghost skills in Quick Reference
- Stale projects-index.md updates
- Project tool config migration to project TOOLS.md

**Reports only:**
- Missing AGENT.md in project .ai/ (critical)
- Missing required root files (critical)
- Broken paths in manual files (never auto-fix)

See SKILL.md for: detailed validation procedures, structure convention rules, full auto-fix matrix
