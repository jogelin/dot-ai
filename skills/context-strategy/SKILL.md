---
name: context-strategy
description: Context window management, delegation patterns, and compaction strategies
triggers: [always]
---

# Context Strategy

Manage context window proactively to avoid truncation and maintain performance.

## Vigilance Thresholds

### < 50% Context: Normal Operation
**Strategy:** No restrictions
- Read files directly in main context
- Spawn sub-agents as needed
- Normal operation mode

### 50-70% Context: Delegation Mode
**Strategy:** Start delegating file reads
- **DO:** Spawn sub-agents for file reads (haiku)
- **DO:** Keep analysis in main context
- **DON'T:** Read large files directly
- **DON'T:** Spawn multiple concurrent Opus agents

**Example:**
```
Instead of: Read 5 files → analyze
Do: Spawn haiku sub-agent "read files X,Y,Z" → analyze in main context
```

### > 70% Context: Aggressive Delegation
**Strategy:** Switch model + aggressive delegation
- **If on Opus:** Switch to Sonnet immediately
- **If on Sonnet:** Continue, but delegate ALL reads
- **DO:** Spawn sub-agents for any file operation
- **DO:** Work from summaries, not full content
- **DON'T:** Read any files directly
- **DON'T:** Spawn new sub-agents unless critical

**Example:**
```
Current: Opus at 75% context
Action: "I'm switching to Sonnet to preserve context budget"
```

### > 85% Context: Memory-Only Mode
**Strategy:** Emergency mode - no new reads
- **STOP:** All file reading operations
- **WORK:** Only with what's already in context
- **DELEGATE:** Everything that requires new information
- **WARN:** User that context is nearly full

**Recovery:**
1. Complete current task with existing context
2. Suggest splitting remaining work into new session
3. Offer to summarize current session for continuity

## Sub-Agent Limits

### Concurrency Rules
- **Max concurrent:** 8 sub-agents (OpenClaw limit)
- **Recommended max:** 4-5 for safety
- **At > 4 active:** Use Haiku for new spawns (even if Sonnet better)
- **Spacing:** Minimum 2-3 seconds between spawns

### When to Delegate
**Always delegate when:**
- Context > 50% AND need to read files
- Multiple file reads needed (batch to sub-agent)
- Repetitive operations (extraction, formatting)

**Never delegate when:**
- Quick single-line reads
- Already at token limit (delegate won't help)
- Critical decision-making (keep in main context)

## Compaction Strategies

### Proactive Compaction
**Trigger compaction when:**
- Approaching 70% context
- Long conversation with repeated information
- After completing major task (clean up before next)

**How to compact:**
1. Summarize completed work
2. Remove redundant examples
3. Keep only essential context
4. Restart session if needed

### Emergency Compaction
**At > 85% context:**
1. Immediately stop adding new content
2. Summarize current state
3. Offer to continue in new session
4. Preserve critical context only

## Cross-References

- Model selection rules: See `model-selection` skill
- Task delegation patterns: See `dot-ai` boot sequence
- Rate limit awareness: See `model-selection` skill
