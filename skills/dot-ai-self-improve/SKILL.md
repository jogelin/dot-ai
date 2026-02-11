---
name: dot-ai-self-improve
description: Auto-correction and knowledge documentation process
triggers: [manual]
internal: true
disable-model-invocation: true
parent: dot-ai
---

# dot-ai-self-improve — Learn From Mistakes

Pattern for auto-correction and knowledge documentation.
When an error is detected, correct it AND document the lesson
so it never happens again.

## Core Pattern

**Observe → Interrupt → Document**

### 1. Observe

Detect errors through:
- User correction ("that's wrong", "not like that", "update your rules")
- Failed tool calls (wrong path, missing file, bad command)
- Repeated searches (>3 tool calls to find one piece of info)
- Incorrect assumptions about project structure or conventions

### 2. Interrupt

Stop the current flow immediately and:
1. **Correct** the error right now
2. **Acknowledge** the mistake explicitly (no hiding)
3. **Identify** the root cause — why did this happen?

### 3. Document

Write the lesson in the RIGHT place:

| Error Type | Document In | Example |
|------------|-------------|---------|
| Workflow/process error | `AGENTS.md` | "Always check X before Y" |
| Skill-specific error | The relevant `SKILL.md` | "Use endpoint /v2 not /v1" |
| Contextual lesson | `MEMORY.md` → "Lessons learned" | "Project X uses monorepo" |
| Tool/setup issue | `TOOLS.md` | "Camera name is X not Y" |

### Documentation Rules

Every lesson MUST be:
- **An actionable instruction**, not a passive observation
- **Specific** — include the exact command, path, or value
- **Formatted as a rule** the agent can follow mechanically

❌ Bad: "The API sometimes returns errors"
✅ Good: "Always retry API calls with 3s backoff — the endpoint rate-limits at 10 req/s"

❌ Bad: "Projects have different structures"
✅ Good: "Check `package.json` for monorepo config before assuming flat structure"

## Auto-Detection: Missing Context

**Trigger**: More than 3 tool calls to find a single piece of information.

When this happens:
1. Complete the current task
2. Ask: "Where should this info live so I find it instantly next time?"
3. Document it:
   - Project-specific → project's `AGENT.md`
   - Global → `TOOLS.md` or `AGENTS.md`
   - Temporary → `memory/YYYY-MM-DD.md`

## File Hierarchy

Not all files are equal. Know what goes where:

| File | Role | Analogy |
|------|------|---------|
| `AGENTS.md` | Operating rules, behavior | GPS navigation rules |
| `SOUL.md` | Identity, persona | Personality profile |
| `TOOLS.md` | Local setup notes | Cheat sheet |
| `MEMORY.md` | Long-term curated memory | Journal highlights |
| `SKILL.md` | Skill-specific instructions | Manual for one tool |

**Principle**: Core files (`AGENTS.md`, `SOUL.md`) are GPS — concise references,
not encyclopedias. If a rule is getting long, it probably belongs in a skill.

## When NOT to Self-Improve

- Don't document one-time flukes (network timeouts, temporary API issues)
- Don't add rules that contradict existing ones — update the existing rule instead
- Don't bloat files — if a file grows past its target size, refactor into a sub-skill
- Don't document user preferences as universal rules (use `USER.md` or `MEMORY.md`)

## Integration

- This pattern is always active — it's a mindset, not a scheduled task
- `dot-ai-audit` may surface issues that trigger self-improvement
- When creating new rules, also check if `AGENTS.md` Skills Quick Reference needs updating
