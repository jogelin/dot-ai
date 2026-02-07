---
name: dot-ai-export
description: Export workspace structure as JSON/YAML for external tools
triggers: [manual]
internal: true
parent: dot-ai
---

# dot-ai-export — Workspace Export

Exports workspace structure (projects, skills, tasks) as structured data (JSON/YAML)
for consumption by external tools, dashboards, or CI/CD pipelines.

## When to Use

- Generating data for external dashboards
- CI/CD integration (list projects, check tasks)
- Documentation generation
- API responses for workspace queries
- Backup/snapshot of workspace state

## Export Formats

### JSON (default)

```json
{
  "version": "0.2.0",
  "timestamp": "2026-02-06T14:30:00Z",
  "projects": [
    {
      "name": "pro",
      "description": "Personal brand smartsdlc.dev",
      "tags": ["blog", "dx", "ai"],
      "path": "projects/pro",
      "skills": [
        {
          "name": "medium-digest",
          "description": "Digest articles Medium/Substack",
          "triggers": ["heartbeat", "cron"]
        }
      ],
      "tasks": {
        "total": 12,
        "urgent": 2,
        "next": 5,
        "later": 3,
        "done": 2
      }
    }
  ],
  "globalSkills": [
    {
      "name": "dot-ai",
      "description": "Universal AI workspace convention",
      "triggers": ["boot", "always"]
    }
  ],
  "globalTasks": {
    "total": 5,
    "urgent": 1,
    "next": 2,
    "later": 1,
    "done": 1
  }
}
```

### YAML

Same structure, YAML-formatted for human readability.

### Markdown Table (compact)

Quick overview format:

```markdown
# Workspace Export — 2026-02-06

## Projects (6)

| Name | Description | Skills | Tasks |
|------|-------------|--------|-------|
| pro | Personal brand smartsdlc.dev | 6 | 12 (2 urgent) |
| roule-caillou | Recherche terrain + vie sobre | 17 | 8 (1 urgent) |
...

## Global Skills (16)

| Name | Triggers |
|------|----------|
| dot-ai | boot, always |
| backlog | always |
...
```

## Usage

```bash
# Export to JSON (default)
dot-ai-export

# Export to YAML
dot-ai-export --format yaml

# Export to Markdown table
dot-ai-export --format markdown

# Export to file
dot-ai-export --output workspace-export.json

# Export specific sections
dot-ai-export --sections projects,skills
dot-ai-export --sections tasks
```

## Export Sections

| Section | Content |
|---------|---------|
| `metadata` | Version, timestamp, workspace root |
| `projects` | All projects with AGENT.md metadata |
| `skills` | Global and per-project skills |
| `tasks` | Global and per-project task summaries |
| `structure` | Directory tree overview |
| `all` | Everything (default) |

## Use Cases

### 1. Dashboard Integration

```bash
# Generate JSON for dashboard
dot-ai-export --format json --output public/workspace.json

# Dashboard reads JSON and displays:
# - Project cards with task counts
# - Skill inventory
# - Urgent tasks across all projects
```

### 2. CI/CD Pipeline

⚠️ **Note:** Standalone export.sh script is planned for future release. For now, invoke the skill directly via Claude Code or OpenClaw.

```yaml
# .github/workflows/workspace-audit.yml (planned implementation)
- name: Export workspace
  run: claude skill invoke dot-ai-export --format json --output workspace-export.json

- name: Check for urgent tasks
  run: |
    URGENT=$(jq '.globalTasks.urgent + ([.projects[].tasks.urgent] | add)' workspace-export.json)
    if [[ $URGENT -gt 10 ]]; then
      echo "⚠️ Too many urgent tasks: $URGENT"
      exit 1
    fi
```

### 3. Documentation Generation

```bash
# Export to Markdown for wiki
dot-ai-export --format markdown > docs/WORKSPACE.md
```

### 4. API Endpoint

Serve workspace data via API:

```bash
# Export to static JSON
dot-ai-export --output public/api/workspace.json

# Access at: https://example.com/api/workspace.json
```

## Output Options

| Flag | Description |
|------|-------------|
| `--format` | json, yaml, markdown |
| `--output` | Write to file instead of stdout |
| `--sections` | Comma-separated sections to include |
| `--pretty` | Pretty-print JSON (default: true) |
| `--minify` | Minify JSON for smaller file size |
| `--include-stats` | Add detailed statistics |
| `--include-paths` | Add full file paths in export |

## Examples

**Basic export:**
```bash
dot-ai-export > workspace.json
```

**Projects only, YAML:**
```bash
dot-ai-export --format yaml --sections projects > projects.yaml
```

**Minified JSON for API:**
```bash
dot-ai-export --format json --minify --output api/workspace.json
```

**Full export with stats:**
```bash
dot-ai-export --include-stats --include-paths > workspace-full.json
```

## Integration with Other Sub-skills

- **workspace-scan** — provides project discovery data
- **agent-sync** — provides project metadata
- **backlog-sync** — provides task statistics
- **audit** — export can run after audit to snapshot validated state

## Security

**Exclude sensitive data:**
- No credentials from TOOLS.md
- No personal data from USER.md
- No private context from MEMORY.md
- Only metadata and structure

**Safe to publish:**
Export JSON is safe to commit to public repos or serve publicly.
