# dot-ai-tools-sync — Quick Reference

Validate TOOLS.md structure and tool references.

## Triggers
- Audit: called by dot-ai-audit during workspace coherence checks
- Manual: "sync tools", "validate tools"

## Validation Rules

### 1. Structure
- Valid markdown format
- Tool categories properly defined
- Required sections present (Overview, Categories, Tool List)
- Auto-generated sections have markers

### 2. Tool Definitions
- Tool names are unique
- Required fields present (name, description, usage)
- Configuration syntax valid (JSON, YAML, bash)
- No malformed code blocks

### 3. References
- No broken links to external tools
- Tool paths exist if specified
- Command examples are valid

### 4. Security
- No hardcoded credentials in examples
- No exposed API keys or tokens
- Safe command examples (no destructive operations without warnings)

### 5. Scope Validation
- Root TOOLS.md: only cross-project tools
- Project TOOLS.md: project-specific tools
- No duplicate definitions between root and project

## Auto-Fix Rules

All auto-fixes require user confirmation:
- Missing sections → Add from template
- Broken markers → Fix or regenerate
- Invalid syntax → Fix common patterns
- Duplicate tools → Merge or remove (with confirmation)
- Missing markers → Add for auto-managed sections

## Output Format

**Valid:** `✅ .ai/TOOLS.md - 12 tools defined, all references valid, markers intact`

**Issues:** `⚠️ .ai/TOOLS.md - Tool 'gh' missing description field, broken link to GitHub CLI docs`

**Error:** `❌ projects/api/.ai/TOOLS.md - Hardcoded API key in example, duplicate tool: 'curl'`

See SKILL.md for: validation process, TOOLS.md template, marker patterns, integration with agent-sync and audit
