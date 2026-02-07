# dot-ai-agent-sync — Quick Reference

Generate and maintain AGENT.md files in project `.ai/` directories using markers.

## Triggers
- **Manual**: "sync agent-md for `<project>`" or "reindex `<project>`"
- **Audit**: called by `dot-ai-audit` when staleness is detected (data/ modified after last sync)

## Marker Pattern

All auto-managed content lives between markers:

```markdown
<!-- dot-ai-agent-sync start -->
...auto-generated content...
<!-- dot-ai-agent-sync end -->
```

**Content OUTSIDE markers is NEVER touched.** Manual sections (Rules, Conventions, Workflows) are preserved.

## Auto-Generated Sections

1. **Metadata (Frontmatter)** — name, description, tags inferred from project
2. **Directory Structure** — tree view (max 3 levels), excludes node_modules/.git/dist/etc
3. **Data Overview** — summarizes `data/` files (max 20 lines, with stats and dates)
4. **Skills** — table of skills from `<project>/.ai/skills/` with descriptions and triggers

## Behavior

- **New AGENT.md**: Generate frontmatter + markers + placeholder for manual content
- **Existing AGENT.md**: Find markers and replace content between them, or append if missing
- **NEVER modify** content outside markers

## Staleness Check

Compare "Last synced" timestamp in markers vs latest file modification in `data/`. If data is newer, auto-sync.

See SKILL.md for: inference rules, exclusion patterns, full output template, commands
