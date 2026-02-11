# dot-ai-self-improve — Quick Reference

Auto-correction and knowledge documentation process.

## Triggers
- Manual: always-active mindset, triggered by error detection

## Core Pattern: Observe -> Interrupt -> Document

### 1. Observe
Detect errors via: user corrections, failed tool calls, repeated searches (>3 calls for one thing), incorrect assumptions.

### 2. Interrupt
Stop current flow. Correct the error. Acknowledge the mistake. Identify root cause.

### 3. Document
Write the lesson in the RIGHT place:

| Error Type | Document In |
|------------|-------------|
| Workflow/process error | `AGENTS.md` |
| Skill-specific error | The relevant `SKILL.md` |
| Contextual lesson | `MEMORY.md` -> "Lessons learned" |
| Tool/setup issue | `TOOLS.md` |

## When to Document
- Actionable instructions, not passive observations
- Specific commands, paths, or values
- Formatted as mechanical rules

## File Hierarchy
- `AGENTS.md` = operating rules (GPS navigation)
- `SOUL.md` = identity/persona (personality)
- `TOOLS.md` = local setup notes (cheat sheet)
- `MEMORY.md` = curated long-term memory (journal highlights)
- `SKILL.md` = skill-specific instructions (tool manual)

## When NOT to Document
- One-time flukes (network timeouts, temporary API issues)
- Rules contradicting existing ones (update existing instead)
- User preferences as universal rules (use USER.md or MEMORY.md)

See SKILL.md for: auto-detection of missing context, file hierarchy details, integration with audit
