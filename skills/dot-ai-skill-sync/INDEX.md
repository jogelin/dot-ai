# dot-ai-skill-sync — Quick Reference

Validate SKILL.md frontmatter and structure across the workspace.

## Triggers
- Audit: called by dot-ai-audit for all SKILL.md files

## Frontmatter Validation Rules

Required fields:
- `name` — kebab-case, must match directory name
- `description` — single line, under 150 characters
- `triggers` — array of valid trigger values

Optional fields:
- `internal: true` — sub-skill, not user-invocable
- `parent: <name>` — required when internal is true
- `status: planned|experimental|deprecated`

## Valid Trigger Types
- `manual` — User-invoked
- `heartbeat` — Periodic checks
- `cron` — Scheduled
- `boot` — Session start
- `always` — Always active
- `audit` — Audit-triggered

## Auto-Fix Actions
- Missing `triggers` field -> add `triggers: [manual]`
- Description too long -> truncate with ellipsis
- Invalid trigger value -> remove invalid, keep valid
- Name mismatch -> update name to match directory

All auto-fixes require user confirmation.

See SKILL.md for: validation process, output format, integration with audit
