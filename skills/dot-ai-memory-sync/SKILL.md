---
name: dot-ai-memory-sync
description: Validate MEMORY.md structure (optional, light validation)
triggers: [manual]
internal: true
parent: dot-ai
status: planned
---

# dot-ai-memory-sync — MEMORY.md Validation

⚠️ **Status: PLANNED** — This sub-skill is documented but not yet implemented.

## Purpose

Validate the structure and format of `MEMORY.md` files (both root and project-level).

## Planned Validation

### Structure Checks

- Valid markdown format
- Presence of expected sections (if any)
- No malformed links
- Reasonable file size (< 50KB)

### Content Checks

- No sensitive data (passwords, API keys)
- No project-specific content in root MEMORY.md
- Dates in ISO format if present

## Integration

Called by `dot-ai-audit` during workspace coherence checks.

## Implementation Status

This skill is planned for a future release. Current behavior:
- `dot-ai-audit` skips MEMORY.md validation
- Manual validation recommended until implemented

## When Implemented

This skill will:
1. Read MEMORY.md files
2. Validate structure and content
3. Report issues with severity levels
4. Suggest corrections
