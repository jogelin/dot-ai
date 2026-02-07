---
name: dot-ai-tools-sync
description: Validate TOOLS.md tool definitions and references
triggers: [manual]
internal: true
parent: dot-ai
---

# dot-ai-tools-sync — TOOLS.md Validation

Quick reference: See [INDEX.md](./INDEX.md)

## Purpose

Validate the structure and format of `TOOLS.md` files, ensuring tool definitions are complete, references are valid, markers are intact, and no security issues exist.

## TOOLS.md Template

Standard structure for TOOLS.md files:

```markdown
# TOOLS — <Workspace/Project Name>

Overview of available tools and integrations.

<!-- dot-ai-tools-sync start -->
## Auto-Generated Tool Index
Last updated: YYYY-MM-DD

- [Tool1](#tool1)
- [Tool2](#tool2)
<!-- dot-ai-tools-sync end -->

## Categories

### Development Tools

**Tool1**
- **Description**: What the tool does
- **Usage**: `command --flags`
- **Config**: Path or inline config
- **Notes**: Additional context

### Integration Tools

**Tool2**
- **Description**: Purpose
- **Usage**: Examples
- **Auth**: How authentication works

## Manual Sections

Content here is never modified by auto-sync.
```

## Validation Process

### 1. Structure Validation

Check file structure and required sections.

**Validation:**
- File exists (at `.ai/TOOLS.md` or `projects/<name>/.ai/TOOLS.md`)
- Valid markdown format
- Has header: `# TOOLS — <name>`
- Has categories section
- Has tool definitions

**Auto-fix:**
- Create missing file from template (with confirmation)
- Fix invalid header format
- Add missing sections

### 2. Marker Validation

Check auto-managed content markers.

**Validation:**
- Markers present: `<!-- dot-ai-tools-sync start -->` and `<!-- dot-ai-tools-sync end -->`
- Markers are properly paired
- Content between markers is valid
- Last-updated timestamp present

**Auto-fix:**
- Add missing markers around auto-generated sections
- Fix broken markers (unpaired, malformed)
- Update timestamp

See [CONVENTIONS.md](../dot-ai/CONVENTIONS.md#marker-pattern) for marker pattern details.

### 3. Tool Definition Validation

Validate individual tool definitions.

**Required fields:**
- **Name** (as heading or bold)
- **Description** (what the tool does)
- **Usage** (command examples or instructions)

**Optional fields:**
- **Config** (configuration file path or inline)
- **Auth** (authentication method)
- **Notes** (additional context)

**Validation:**
- All tools have required fields
- No duplicate tool names
- Tool names are descriptive (not just commands)

**Common issues:**
```markdown
❌ Bad:
**curl**
Usage: `curl https://api.example.com`

✅ Good:
**curl — HTTP Client**
- **Description**: Command-line tool for making HTTP requests
- **Usage**: `curl -H "Authorization: Bearer $TOKEN" https://api.example.com`
- **Notes**: Supports REST, GraphQL, and file uploads
```

**Auto-fix:**
- Warn about minimal definitions (name + usage only)
- Suggest adding descriptions
- Flag duplicate names

### 4. Reference Validation

Check external references and links.

**Validation:**
- Links to tool documentation are valid (check URL format)
- File paths exist if specified (config files, scripts)
- Command examples use valid syntax

**Issues to detect:**
- Broken links (404, malformed URLs)
- Missing files referenced in "Config" fields
- Invalid command syntax in usage examples

**Auto-fix:**
- Warn about broken links (cannot auto-fix external URLs)
- Offer to remove references to missing files
- Suggest fixing obvious syntax errors

### 5. Security Validation

Critical: Check for exposed secrets.

**Patterns to detect:**
- API keys: `sk-[a-zA-Z0-9]{32,}`, `Bearer [a-zA-Z0-9]+`
- Passwords: `password: 'plaintext'`, `pwd=secret`
- Tokens: `token: ghp_[a-zA-Z0-9]+`, `GITHUB_TOKEN=ghp_...`
- Credentials: `username:password@host`

**Examples:**

```markdown
❌ Exposed:
**gh — GitHub CLI**
- **Auth**: `export GITHUB_TOKEN=ghp_abc123def456xyz789`

✅ Safe:
**gh — GitHub CLI**
- **Auth**: `export GITHUB_TOKEN=<your-token>` or `gh auth login`
```

**Action:**
- ERROR (block completion) if credentials detected
- Never auto-fix (user must manually redact)
- Suggest using environment variables or placeholders

### 6. Configuration Syntax Validation

Validate inline configuration examples.

**Common formats:**
- JSON: `{ "key": "value" }`
- YAML: `key: value`
- TOML: `key = "value"`
- Shell: `export VAR=value`

**Validation:**
- Syntax is valid for declared format
- Code blocks have language hints
- No trailing commas in JSON
- Proper indentation in YAML

**Auto-fix:**
- Add missing language hints to code blocks
- Fix common syntax errors (with confirmation)

### 7. Scope Validation

Check tool definitions are in correct file.

**Root TOOLS.md** (`.ai/TOOLS.md`):
- Cross-project tools (git, gh, docker, npm)
- Workspace-wide integrations
- Shared development tools

**Project TOOLS.md** (`projects/<name>/.ai/TOOLS.md`):
- Project-specific tools
- Local scripts
- Project-unique integrations

**Validation:**
- No duplicate tools between root and project
- Project tools are actually project-specific
- Root tools are truly cross-project

**Issues:**
```
⚠️ Tool 'eslint' defined in both root and project TOOLS.md
⚠️ Tool 'deploy-script' in root TOOLS.md seems project-specific
```

**Auto-fix:**
- Warn about duplicates (user decides which to keep)
- Suggest moving project-specific tools from root to project

## Integration

### Called by dot-ai-audit

```typescript
// audit triggers tools-sync for all TOOLS.md files
const toolsFiles = findToolsFiles();  // root + all projects
for (const file of toolsFiles) {
  await validateToolsFile(file);
}
```

### Related Skills

- **[agent-sync](../dot-ai-agent-sync/SKILL.md)** — similar marker-based updates for AGENT.md
- **[workspace-scan](../dot-ai-workspace-scan/SKILL.md)** — finds all TOOLS.md files
- **[dot-ai-audit](../dot-ai-audit/SKILL.md)** — orchestrates all validation

## Output Format

See [CONVENTIONS.md](../dot-ai/CONVENTIONS.md#output-formats) for standard output format.

**Example outputs:**

```
✅ .ai/TOOLS.md — 12 tools defined, all references valid, markers intact

⚠️ .ai/TOOLS.md — Tool 'gh' missing description field, broken link to GitHub CLI docs

❌ projects/api/.ai/TOOLS.md — Hardcoded API key in 'curl' example, duplicate tool: 'docker'
```

## Commands

Manual invocation:

```
"sync tools"
"validate tools"
"check TOOLS.md"
```

Auto-invocation by audit:

```
"audit workspace"  # includes tools-sync
```

## Marker Usage

Tools-sync uses markers to manage auto-generated content (tool index, metadata).

**What's auto-managed:**
- Tool index (list of all defined tools)
- Last-updated timestamp
- Tool count statistics

**What's manual:**
- Tool definitions (name, description, usage)
- Categories and organization
- Custom notes and sections

**Example:**

```markdown
<!-- dot-ai-tools-sync start -->
## Auto-Generated Tool Index
Last updated: 2024-02-07
Total tools: 12

- [git](#git)
- [gh](#gh)
- [docker](#docker)
<!-- dot-ai-tools-sync end -->

## Development Tools

**git — Version Control**
- **Description**: Distributed version control system
- **Usage**: `git status`, `git commit -m "message"`
```

Content between markers is regenerated on sync. Tool definitions below are preserved.
