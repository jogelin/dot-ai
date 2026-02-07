# dot-ai-workspace-scan — Quick Reference

Scan `.ai/` directories and generate compact workspace overview for routing.

## Triggers
- Boot: Phase 2 of dot-ai boot sequence (automatic)
- Manual: "rescan workspace", "update projects index"

## Scan Process
1. Find all `.ai/` directories (maxdepth 3, exclude root)
2. Read frontmatter-only from each `AGENT.md` (name, description, tags)
3. List skills in `.ai/skills/` and read their frontmatter
4. Build compact overview (~300 token budget)
5. Write persistent index to `.ai/memory/projects-index.md`

## Output

### In-Memory Overview
```
📁 <name> — <description> [<tags>]
   📋 <skill> — <description> [<triggers>]
```
Used for real-time prompt routing during session.

### Persistent Index File
Location: `.ai/memory/projects-index.md`
Format: Markdown table + skill lists with update markers
Update strategy: regenerate if missing or >7 days old

## Boot Log Contribution
```
├─ 📁 6 projects, 22 skills
├─ 📋 projects-index.md — fresh (3d)
```

With warnings:
```
├─ 📁 5 projects, 18 skills
├─ 📋 projects-index.md — regenerated (was 9d old)
├─ ⚠️ todo — missing AGENT.md frontmatter
```

See SKILL.md for: frontmatter format, error handling, relationship to dot-ai-audit and dot-ai-agent-sync
