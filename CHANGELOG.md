## 0.6.0 (2026-03-06)

### 🚀 Features

- unified v6 extension system — rename providers to ext-*, remove backward compat ([c2bddbe](https://github.com/jogelin/dot-ai/commit/c2bddbe))
- **core:** add describe() to MemoryProvider for self-describing memory systems ([50b86f1](https://github.com/jogelin/dot-ai/commit/50b86f1))
- **core:** inject recent in-progress tasks at boot ([eec5d1a](https://github.com/jogelin/dot-ai/commit/eec5d1a))
- **core:** capabilities system + token budget + OpenClaw refactor (v4.2 Phase 1) ([224814c](https://github.com/jogelin/dot-ai/commit/224814c))
- **core:** hooks mechanism + Claude Code MCP server + multi-hook dispatch (v4.2 Phase 2) ([7405b0b](https://github.com/jogelin/dot-ai/commit/7405b0b))
- **core:** DotAiRuntime + observation fixes + hooks tests (v4.2 Phase 3) ([26158a5](https://github.com/jogelin/dot-ai/commit/26158a5))
- **core:** link @dot-ai/cockpit-tasks from kiwi workspace ([38f90a7](https://github.com/jogelin/dot-ai/commit/38f90a7))
- **identity:** selective identity loading — load() root-only, match() for project nodes ([6e89ff9](https://github.com/jogelin/dot-ai/commit/6e89ff9))
- **infra:** switch to npm Trusted Publishing (OIDC) ([a8c9ba4](https://github.com/jogelin/dot-ai/commit/a8c9ba4))
- **infra:** add specifier input to release workflow ([ca4bc68](https://github.com/jogelin/dot-ai/commit/ca4bc68))
- **memory:** implement lifecycle management in SQLite provider ([ba7eb76](https://github.com/jogelin/dot-ai/commit/ba7eb76))
- **openclaw:** replace memory-core via slot system with dot-ai providers ([09217ed](https://github.com/jogelin/dot-ai/commit/09217ed))
- **openclaw:** register task_list, task_create, task_update tools ([7c368fa](https://github.com/jogelin/dot-ai/commit/7c368fa))

### 🩹 Fixes

- **ci:** remove local file dep on @dot-ai/cockpit-tasks ([1bc5993](https://github.com/jogelin/dot-ai/commit/1bc5993))
- **core:** address architecture review — 7 fixes across capabilities, hooks, loader, budget ([548f77e](https://github.com/jogelin/dot-ai/commit/548f77e))
- **core:** use globalThis for provider registry to survive jiti module duplication ([8806ffc](https://github.com/jogelin/dot-ai/commit/8806ffc))
- **core:** pass provider factories via RuntimeOptions to bypass registry isolation ([be75091](https://github.com/jogelin/dot-ai/commit/be75091))
- **openclaw:** add skipIdentities to DotAiRuntime options ([f238d44](https://github.com/jogelin/dot-ai/commit/f238d44))
- **openclaw:** explicitly register providers to fix jiti resolution ([804e761](https://github.com/jogelin/dot-ai/commit/804e761))
- **openclaw:** build providers directly in adapter, bypass loader entirely ([28b19fb](https://github.com/jogelin/dot-ai/commit/28b19fb))
- **sqlite-memory:** make describe() assert exclusive memory system ([85e5535](https://github.com/jogelin/dot-ai/commit/85e5535))

### ❤️ Thank You

- Claude Opus 4.6
- Jonathan Gelin @jogelin

## 0.5.2 (2026-03-04)

### 🩹 Fixes

- **infra:** add repository field to all packages for npm provenance ([fb369f7](https://github.com/jogelin/dot-ai/commit/fb369f7))

### ❤️ Thank You

- Claude Opus 4.6
- Jonathan Gelin @jogelin

## 0.5.1 (2026-03-04)

### 🩹 Fixes

- **infra:** remove registry from publishConfig ([0da69b3](https://github.com/jogelin/dot-ai/commit/0da69b3))
- **infra:** remove --first-release flag (v0.5.0 tag exists now) ([b925ba8](https://github.com/jogelin/dot-ai/commit/b925ba8))

### ❤️ Thank You

- Claude Opus 4.6
- Jonathan Gelin @jogelin

## 0.5.0 (2026-03-04)

### 🚀 Features

- add OpenClaw support + fix workspace root detection via symlinks ([a6c381b](https://github.com/jogelin/dot-ai/commit/a6c381b))
- migrate to official OpenClaw plugin SDK ([74551cc](https://github.com/jogelin/dot-ai/commit/74551cc))
- massive token optimization at startup (83% reduction) ([2c20cd9](https://github.com/jogelin/dot-ai/commit/2c20cd9))
- comprehensive skill optimization - 63% startup token reduction ([e611ecf](https://github.com/jogelin/dot-ai/commit/e611ecf))
- complete Phase 4-6 - templates, conventions, new skills ([6eb4c38](https://github.com/jogelin/dot-ai/commit/6eb4c38))
- add boot check for in-progress tasks + update boot log format ([10833dd](https://github.com/jogelin/dot-ai/commit/10833dd))
- update model-selection with Sonnet 4.6 benchmarks ([#89](https://github.com/jogelin/dot-ai/pull/89))
- implement adapter-claude bridge and CLI commands ([2691df4](https://github.com/jogelin/dot-ai/commit/2691df4))
- add marketplace.json for Claude Code plugin discovery ([e405d1c](https://github.com/jogelin/dot-ai/commit/e405d1c))
- ⚠️  dot-ai v4 — contract-based architecture ([6e6e6ab](https://github.com/jogelin/dot-ai/commit/6e6e6ab))
- ⚠️  **adapter-claude:** v4 — deterministic context enrichment via command hooks ([df21a5d](https://github.com/jogelin/dot-ai/commit/df21a5d))
- ⚠️  **adapter-openclaw:** v4 — deterministic pipeline integration ([56323e0](https://github.com/jogelin/dot-ai/commit/56323e0))
- **adapter-sync:** add file-sync adapter for Cursor/Copilot/generic ([800b390](https://github.com/jogelin/dot-ai/commit/800b390))
- ⚠️  **cli:** v4 — init, boot, trace commands ([d25bb13](https://github.com/jogelin/dot-ai/commit/d25bb13))
- **cli:** enhanced trace with token estimates, --json, --verbose ([cff761b](https://github.com/jogelin/dot-ai/commit/cff761b))
- **cockpit-tasks:** add Cockpit REST API task provider for v4 ([9e8b157](https://github.com/jogelin/dot-ai/commit/9e8b157))
- **core:** implement file-based providers, discovery, boot, and workspace validation ([f90b80d](https://github.com/jogelin/dot-ai/commit/f90b80d))
- **core:** add CockpitTaskProvider + config.yaml provider factory ([1840e52](https://github.com/jogelin/dot-ai/commit/1840e52))
- ⚠️  **core:** v4 contracts — 6 provider interfaces + shared types ([32db58d](https://github.com/jogelin/dot-ai/commit/32db58d))
- **core:** add engine, config loader, provider registry, label extraction ([8862aaf](https://github.com/jogelin/dot-ai/commit/8862aaf))
- **core:** add 6 file-based default providers ([d8de907](https://github.com/jogelin/dot-ai/commit/d8de907))
- **core:** add auto-discovery for provider packages via dynamic import ([b319e2c](https://github.com/jogelin/dot-ai/commit/b319e2c))
- **core:** support triggers as vocabulary source + scan project skills ([cc1a614](https://github.com/jogelin/dot-ai/commit/cc1a614))
- **core:** optimize token usage — skip identities, truncate skills, cap matches ([55b2e13](https://github.com/jogelin/dot-ai/commit/55b2e13))
- **core:** add skill enable/disable mechanism ([3013af0](https://github.com/jogelin/dot-ai/commit/3013af0))
- **core:** add tracing/logging system ([01bf7ac](https://github.com/jogelin/dot-ai/commit/01bf7ac))
- **core:** add distributed node system ([10d2420](https://github.com/jogelin/dot-ai/commit/10d2420))
- **infra:** add CI, release workflow, secretlint, and publishConfig ([5370267](https://github.com/jogelin/dot-ai/commit/5370267))
- **openclaw:** use @dot-ai/core boot and discovery in adapter ([b6fe1a3](https://github.com/jogelin/dot-ai/commit/b6fe1a3))
- **openclaw:** support custom provider loading via pluginConfig ([8138c37](https://github.com/jogelin/dot-ai/commit/8138c37))
- **sqlite-memory:** add SQLite + FTS5 memory provider ([2157340](https://github.com/jogelin/dot-ai/commit/2157340))
- **sqlite-memory:** add node/source columns, path resolution, and migration script ([94058e4](https://github.com/jogelin/dot-ai/commit/94058e4))

### 🩹 Fixes

- correct author name to Jonathan Gelin ([0dffd55](https://github.com/jogelin/dot-ai/commit/0dffd55))
- resolve symlink loops + ensure .ai/ structure on first sync ([44a4561](https://github.com/jogelin/dot-ai/commit/44a4561))
- only update existing agent configs, never create new ones ([cccdb5b](https://github.com/jogelin/dot-ai/commit/cccdb5b))
- update sub-skills path reference (sub-skills/ → skills/) ([57cebcb](https://github.com/jogelin/dot-ai/commit/57cebcb))
- comprehensive code review fixes (CRITICAL + HIGH priority) ([72fc502](https://github.com/jogelin/dot-ai/commit/72fc502))
- P1+P2 audit fixes — delegation gaps, frontmatter, INDEX.md, translations ([126d102](https://github.com/jogelin/dot-ai/commit/126d102))
- add disable-model-invocation to all 14 internal sub-skills ([442799a](https://github.com/jogelin/dot-ai/commit/442799a))
- restore root openclaw.plugin.json and .claude-plugin for plugin loading ([5a63dd1](https://github.com/jogelin/dot-ai/commit/5a63dd1))
- **adapter-claude:** correct plugin manifest paths for repo-root installation ([f1de9f9](https://github.com/jogelin/dot-ai/commit/f1de9f9))
- **core:** inject workspaceRoot into provider options via adapters ([06d14db](https://github.com/jogelin/dot-ai/commit/06d14db))
- **core:** strip YAML quotes in config parser + inject workspaceRoot ([e6d1f38](https://github.com/jogelin/dot-ai/commit/e6d1f38))
- **core:** race conditions, learn truncation, label boundaries, fetch timeout ([aeb05f2](https://github.com/jogelin/dot-ai/commit/aeb05f2))
- **core:** address architecture review issues ([c700ef5](https://github.com/jogelin/dot-ai/commit/c700ef5))
- **infra:** add packageManager field + --first-release flag ([9419ec1](https://github.com/jogelin/dot-ai/commit/9419ec1))
- **infra:** remove redundant auth line from .npmrc ([0a3245e](https://github.com/jogelin/dot-ai/commit/0a3245e))
- **infra:** move build+test from preVersionCommand to explicit CI step ([f9bc696](https://github.com/jogelin/dot-ai/commit/f9bc696))
- **infra:** add build dependency to test target ([c796cbf](https://github.com/jogelin/dot-ai/commit/c796cbf))
- **infra:** separate build and test steps in CI workflows ([6ec6e10](https://github.com/jogelin/dot-ai/commit/6ec6e10))
- **infra:** configure git identity for release commits ([c232231](https://github.com/jogelin/dot-ai/commit/c232231))
- **sqlite-memory:** add node support and OR label semantics ([1f4ebee](https://github.com/jogelin/dot-ai/commit/1f4ebee))

### 🔥 Performance

- skip bootstrap injection for sub-agents and cron sessions ([863a1a2](https://github.com/jogelin/dot-ai/commit/863a1a2))

### ⚠️  Breaking Changes

- dot-ai v4 — contract-based architecture  ([6e6e6ab](https://github.com/jogelin/dot-ai/commit/6e6e6ab))
  v3 API removed. New contract-based API.
  Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
- **cli:** v4 — init, boot, trace commands  ([d25bb13](https://github.com/jogelin/dot-ai/commit/d25bb13))
- **adapter-claude:** v4 — deterministic context enrichment via command hooks  ([df21a5d](https://github.com/jogelin/dot-ai/commit/df21a5d))
- **adapter-openclaw:** v4 — deterministic pipeline integration  ([56323e0](https://github.com/jogelin/dot-ai/commit/56323e0))
- **core:** v4 contracts — 6 provider interfaces + shared types  ([32db58d](https://github.com/jogelin/dot-ai/commit/32db58d))

### ❤️ Thank You

- Claude Opus 4.6
- Claude Sonnet 4.5
- Claude Sonnet 4.6
- Jonathan Gelin @jogelin