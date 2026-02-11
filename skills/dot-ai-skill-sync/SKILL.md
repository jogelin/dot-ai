---
name: dot-ai-skill-sync
description: Validate SKILL.md frontmatter and structure
triggers: [audit]
internal: true
disable-model-invocation: true
parent: dot-ai
---

# dot-ai-skill-sync — SKILL.md Validation

Validates `SKILL.md` files across the workspace (global and project-level).
Called by `dot-ai-audit` for validation.

## Validation Checklist

### Frontmatter Fields

```yaml
---
name: <skill-name>          # REQUIRED, kebab-case
description: <one-line>     # REQUIRED, <150 chars
triggers: [...]             # REQUIRED, array of valid triggers
internal: true              # OPTIONAL, only for sub-skills (not user-invocable)
parent: dot-ai              # OPTIONAL, only when internal: true
status: planned             # OPTIONAL, mark as planned/experimental/deprecated
---
```

**Field semantics:**
- `internal: true` + `parent: <name>` → sub-skill, part of a larger skill system
- No `internal` field → public skill, user-invocable
- `status: planned` → documented but not yet implemented

### Valid Trigger Values

- `manual` — User-invoked
- `heartbeat` — Periodic checks
- `cron` — Scheduled
- `boot` — Session start
- `always` — Always active
- `audit` — Audit-triggered

### Structure Rules

1. **Frontmatter must be first** (before any content)
2. **YAML must parse** without errors
3. **Name must match directory** (for project skills)
4. **Description must be concise** (<150 chars, one line)
5. **Triggers must be valid** (from allowed list above)

## Validation Process

```bash
# For each SKILL.md found:
1. Read frontmatter (between --- markers)
2. Parse YAML (detect syntax errors)
3. Check required fields present
4. Validate trigger values
5. Check description length
6. (Optional) Verify name matches directory
```

## Output Format

**Valid skill:**
```
✅ .ai/skills/dot-ai/SKILL.md
```

**Invalid skill with errors:**
```
❌ projects/pro/.ai/skills/medium-digest/SKILL.md
   - Missing required field: triggers
   - Description too long (187 chars, max 150)
```

**YAML parse error:**
```
❌ .ai/skills/backlog/SKILL.md
   - YAML parse error on line 4: unexpected ':'
```

## Integration with Audit

`dot-ai-audit` delegates skill validation to this sub-skill:

```
For each SKILL.md found in workspace:
  result = dot-ai-skill-sync.validate(skill_path)
  if result.errors:
    report errors
```

## Auto-Fix (Optional)

This skill can optionally offer auto-fixes for common issues:

| Issue | Auto-Fix |
|-------|----------|
| Missing `triggers` field | Add `triggers: [manual]` (default) |
| Description too long | Truncate + add ellipsis |
| Invalid trigger value | Remove invalid, keep valid ones |
| Name mismatch | Update name to match directory |

**Auto-fix only with user confirmation.**

## Commands

| Command | Action |
|---------|--------|
| "validate skill <path>" | Validate single SKILL.md |
| "validate all skills" | Validate all SKILL.md in workspace |
| "fix skill <path>" | Auto-fix issues in SKILL.md |
