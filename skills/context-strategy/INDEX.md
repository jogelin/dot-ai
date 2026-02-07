# context-strategy — Quick Reference

Context window management and delegation strategies.

## Triggers
- Always active (automatic vigilance)
- Referenced by: dot-ai/BOOTSTRAP.md

## Context Budget Thresholds

| Usage | Strategy |
|-------|----------|
| < 50% | Normal operation |
| 50-70% | Delegate reads to sub-agents |
| > 70% | Switch to Sonnet if on Opus, delegate aggressively |
| > 85% | Stop reading files, work from memory only |

## Key Rules
1. Monitor context usage continuously
2. Delegate before you hit limits
3. Prefer sub-agents for file reads at 50%+
4. Never let context reach 95%

See SKILL.md for: delegation patterns, compaction strategies, sub-agent limits
