# dot-ai-export — Quick Reference

Export workspace structure as JSON/YAML for external tools, dashboards, and CI/CD.

## Triggers
- Auto: none
- Manual: "export workspace", "generate workspace JSON/YAML"

## Quick Commands
```bash
dot-ai-export                              # JSON to stdout
dot-ai-export --format yaml                # YAML format
dot-ai-export --format markdown            # Markdown table
dot-ai-export --output workspace.json      # Save to file
dot-ai-export --sections projects,skills   # Specific sections only
```

## Output Formats
- **JSON** (default) — structured data for APIs/tools
- **YAML** — human-readable alternative
- **Markdown Table** — quick overview format

## Key Sections
- `metadata` — version, timestamp, workspace root
- `projects` — all projects with AGENT.md metadata
- `skills` — global and per-project skills
- `tasks` — global and per-project task summaries
- `structure` — directory tree overview
- `all` — everything (default)

## Use Cases
1. **Dashboard Integration** — generate JSON for web dashboards showing project cards and task counts
2. **CI/CD Pipeline** — export task statistics, fail builds if too many urgent tasks
3. **Documentation Generation** — export to Markdown for wiki/docs
4. **API Endpoint** — serve workspace data as static JSON
5. **Backup/Snapshot** — capture workspace state at a point in time

## Options
`--pretty` (default), `--minify`, `--include-stats`, `--include-paths`

## Security
Excludes sensitive data (credentials, personal info, private context). Safe to publish publicly.

See SKILL.md for: format specifications, detailed section content, integration with workspace-scan/agent-sync/backlog-sync, CI/CD examples
