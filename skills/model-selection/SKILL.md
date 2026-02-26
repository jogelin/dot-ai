---
name: model-selection
description: Smart model selection for sub-agents and main session. Cost optimization, rate limit awareness.
triggers: [always]
---

# Model Selection

Automatic model selection rules. This skill MUST be consulted before each `sessions_spawn` and each model switch decision in the main session.

## Available Models

| Alias | API ID | Relative Cost | Context | Reasoning |
|-------|--------|--------------|---------|-----------|
| **opus** | `claude-opus-4-6` | $$$$$ | 1M | ✅ adaptive (4 levels) |
| **sonnet** | `claude-sonnet-4-6` | $$ | 1M | ✅ adaptive (4 levels) |  
| **haiku** | `claude-haiku-4-5` | $ | 200K | ❌ |

> **Feb 2026 update**: Claude 4.6 generation (Sonnet/Opus) available. Sonnet 4.6 beats older Opus versions on most tasks.
> Both 4.6 models support adaptive thinking with effort levels (low/medium/high/max).
> Sonnet 4.6 is the smart default for almost everything except complex multi-agent orchestration (use Opus 4.6).
> Haiku 4.5 remains the best choice for pure execution tasks.

## Selection Rules — Sub-agents (`sessions_spawn`)

### Haiku (default for execution)
- OCR, data extraction
- Audit, verification, bulk operations
- Scraping, information gathering
- File reading/summarization
- File updates (BACKLOG, indexes)
- Formatting, HTML reports
- Any task with clear instructions and little ambiguity

### Sonnet (standard development)
- Development, refactoring, code review
- Extensive web research (multiple URLs)
- Content analysis and synthesis
- Article/documentation writing
- Codebase exploration

### Opus (complex reasoning)
- Planning, architecture, strategic decisions
- Ambiguous problems requiring judgment
- Complex code peer review
- **NEVER spawn an Opus sub-agent unless explicitly requested**

## Selection Rules — Main Session

### When to stay in Opus
- Direct conversation with the user (decisions, planning)
- Complex, multi-step reasoning
- First discussion on a new topic

### When to switch to Sonnet
- Exploration/research phase (multiple web_fetch)
- File editing, documentation updates
- Casual conversation, quick Q&A
- Brainstorming (Opus = overkill)
- **Switch proactively** — don't wait for the user to notice

### When to switch to Haiku
- Heartbeat checks (already configured in OpenClaw)
- Repetitive mechanical tasks

## Rate Limit Awareness

### Protection Rules
- Max 8 concurrent sub-agents (configured in OpenClaw)
- If > 4 active sub-agents: use Haiku for new ones (even if Sonnet would be better)
- If rate limit hit: immediately fall back to lower tier
- Space sub-agent spawns by minimum 2-3 seconds

### Anti-patterns
- ❌ NEVER spawn 5+ Opus sub-agents in parallel
- ❌ NEVER do multiple web_fetch in main context while in Opus
- ❌ NEVER use Opus for a data collection/extraction sub-agent
- ❌ NEVER forget to specify the model in `sessions_spawn`

## Tracking

For each `sessions_spawn`, mentally verify:
1. ✅ Model specified? (don't leave default Opus)
2. ✅ Model appropriate for task type?
3. ✅ Number of active sub-agents OK?
4. ✅ Is main context preserved?

## Cross-References

- Context management: See `context-strategy` skill
- Sub-agent delegation: See `context-strategy` skill
- Boot sequence: See `dot-ai` skill
