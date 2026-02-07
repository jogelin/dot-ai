# dot-ai-memory-sync — Quick Reference

Validate memory/ directory structure and session notes.

## Triggers
- Audit: called by dot-ai-audit during workspace coherence checks
- Manual: "sync memory", "validate memory structure"

## Validation Rules

### 1. Daily Notes
- Follow `YYYY-MM-DD.md` format
- Located in `.ai/memory/` or `projects/<name>/.ai/memory/`
- Valid ISO date in filename
- Reasonable file size (< 1MB)

### 2. Projects Index
- `projects-index.md` exists in `.ai/memory/`
- Valid markdown table format
- No broken project references

### 3. Directory Structure
- `tasks/` directory exists with valid task files
- `research/` directory organized with valid markdown
- No orphan memory files outside standard locations

### 4. Content Safety
- No sensitive data (passwords, API keys)
- No malformed markdown links
- Dates in ISO format where present

## Auto-Fix Rules

All auto-fixes require user confirmation:
- Missing directories → Create standard structure
- Incorrectly named files → Rename to YYYY-MM-DD.md format
- Orphan files → Move to research/ or delete (with confirmation)
- Missing projects-index.md → Regenerate from workspace-scan

## Output Format

**Valid:** `✅ .ai/memory/ - 45 daily notes, projects-index fresh (2d) - All directories valid`

**Issues:** `⚠️ .ai/memory/ - File '2024-2-5.md' should be '2024-02-05.md' - Orphan file: random-notes.md`

**Error:** `❌ projects/app/.ai/memory/ - Missing tasks/ directory - Malformed date: 'jan-15-2024.md'`

See SKILL.md for: validation process, memory organization guidelines, integration with workspace-scan and audit
