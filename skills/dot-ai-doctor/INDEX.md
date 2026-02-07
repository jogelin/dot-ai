# dot-ai-doctor — Quick Reference

Diagnose and fix workspace health issues.

## Triggers
- Manual: "doctor", "health check", "diagnose workspace"
- Auto: on sync errors (offer to run doctor)

## Health Checks
1. `.ai/` structure and permissions
2. Required files present (AGENTS.md)
3. Symlinks valid (skills/dot-ai)
4. No orphan files
5. Caches fresh (<7 days)
6. Disk space sufficient

## Output
- Health score (0-100)
- Issues found with severity
- Fix suggestions

See SKILL.md for: detailed checks, auto-fix procedures, troubleshooting guide
