# model-selection — Quick Reference

Smart model selection for sub-agents and main session.

## Triggers
- Always active: consulted before every sub-agent spawn

## Model Tier Table

| Alias | Cost | Use For |
|-------|------|---------|
| **haiku** | $ | OCR, extraction, audit, scraping, file updates, formatting |
| **sonnet** | $$ | Development, research, content writing, code review, exploration |
| **opus** | $$$$$ | Planning, architecture, ambiguous problems. NEVER spawn unless explicitly requested |

## Anti-Patterns
- NEVER spawn 5+ Opus sub-agents in parallel
- NEVER do multiple web_fetch in main context while in Opus
- NEVER use Opus for data collection/extraction sub-agents
- NEVER forget to specify the model in sub-agent spawn

## Pre-Spawn Checklist
1. Model specified? (do not leave default Opus)
2. Model appropriate for task type?
3. Number of active sub-agents OK? (max 8, use Haiku if >4 active)
4. Main context preserved?

## Main Session Rules
- Stay in Opus: direct conversation, complex reasoning, new topic planning
- Switch to Sonnet: exploration/research, file editing, casual Q&A, brainstorming
- Switch to Haiku: heartbeat checks, repetitive mechanical tasks

## Rate Limit Protection
- Max 8 concurrent sub-agents
- If >4 active: force Haiku for new spawns
- Space sub-agent spawns by 2-3 seconds minimum

See SKILL.md for: full model IDs, rate limit details, cross-references
