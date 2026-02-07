# dot-ai-migrate — Quick Reference

Migrate workspace from old dot-ai convention version to current.

## Triggers
- Auto: When `.ai/VERSION` differs from skill version
- Manual: "migrate dot-ai to latest", "upgrade .ai convention", "rollback migration"

## Safety Protocol
1. **Backup**: Create timestamped backup in `.ai/backups/migration-{timestamp}/`
2. **Detect**: Compare workspace VERSION vs skill VERSION, show changelog
3. **Apply**: Execute migration steps for detected version path
4. **Validate**: Run `dot-ai-audit` to verify new structure (rollback on failure)

## Commands
| Command | Action |
|---------|--------|
| "migrate dot-ai" | Detect version and migrate |
| "migrate to version X.Y.Z" | Force migration to specific version |
| "check migration needed" | Compare versions, show if update needed |
| "rollback migration" | Restore from latest backup |

## Current Version
0.2.0

## Supported Migrations
- **0.1.0 → 0.2.0**: Auto-generated projects-index.md, new sub-skills pattern, memory conventions clarified

## Safety Rules
1. Always backup before migration
2. Never delete backups (kept in `.ai/backups/`)
3. Rollback if validation fails
4. Test in branch first if possible

See SKILL.md for: migration paths, rollback procedures, validation steps, version-specific breaking changes
