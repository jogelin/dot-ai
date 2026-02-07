---
name: dot-ai-tools-sync
description: Validate TOOLS.md tool definitions (optional)
triggers: [manual]
internal: true
parent: dot-ai
status: planned
---

# dot-ai-tools-sync — TOOLS.md Validation

⚠️ **Status: PLANNED** — This sub-skill is documented but not yet implemented.

## Purpose

Validate the structure and format of `TOOLS.md` files (both root and project-level).

## Planned Validation

### Structure Checks

- Valid markdown format
- Tool definitions use consistent format
- Required fields present (tool name, description)
- No duplicate tool names

### Content Checks

- Credentials not hardcoded in examples
- Tool paths exist if specified
- Configuration syntax valid (JSON, YAML, etc.)

### Scope Validation

- Root TOOLS.md: only cross-project tools
- Project TOOLS.md: project-specific tools
- No duplicate definitions between root and project

## Integration

Called by `dot-ai-audit` during workspace coherence checks.

## Implementation Status

This skill is planned for a future release. Current behavior:
- `dot-ai-audit` skips TOOLS.md validation
- Manual validation recommended until implemented

## When Implemented

This skill will:
1. Read TOOLS.md files at root and project level
2. Parse tool definitions
3. Validate against schema
4. Check for security issues
5. Report issues with severity levels
6. Suggest corrections
