#!/usr/bin/env node
/**
 * dot-ai hook for Claude Code.
 * Dispatches by event type via CLI arg.
 *
 * Usage in hooks.json:
 *   "UserPromptSubmit": [{ "type": "command", "command": "node hook.js prompt-submit" }]
 *   "PreCompact":       [{ "type": "command", "command": "node hook.js pre-compact" }]
 *   "Stop":             [{ "type": "command", "command": "node hook.js stop" }]
 *   "PreToolUse":       [{ "type": "command", "command": "node hook.js pre-tool-use" }]
 */
import {
  loadConfig,
  registerDefaults,
  createProviders,
  boot,
  enrich,
  learn,
  injectRoot,
  formatContext,
  NoopLogger,
  JsonFileLogger,
  type Providers,
  type BootCache,
} from '@dot-ai/core';
import type { Logger } from '@dot-ai/core';

// ── Shared helpers ──

async function readStdin(): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

function createLogger(rawConfig: { debug?: { logPath?: string } }): Logger {
  const logPath = process.env.DOT_AI_LOG ?? rawConfig.debug?.logPath;
  return logPath ? new JsonFileLogger(logPath) : new NoopLogger();
}

async function initPipeline(workspaceRoot: string): Promise<{
  providers: Providers;
  cache: BootCache;
  logger: Logger;
}> {
  registerDefaults();
  const rawConfig = await loadConfig(workspaceRoot);
  const config = injectRoot(rawConfig, workspaceRoot);
  const logger = createLogger(rawConfig);
  const providers = await createProviders(config);
  const cache = await boot(providers, logger);
  return { providers, cache, logger };
}

// ── Event handlers ──

/** UserPromptSubmit — enrich pipeline + inject context (existing behavior) */
async function handlePromptSubmit(event: Record<string, unknown>): Promise<void> {
  const workspaceRoot = (event.cwd as string) ?? process.cwd();
  const { providers, cache, logger } = await initPipeline(workspaceRoot);

  const prompt = (event.prompt ?? event.content ?? '') as string;
  if (!prompt) {
    await logger.flush();
    return;
  }

  const enriched = await enrich(prompt, providers, cache, logger);

  for (const skill of enriched.skills) {
    if (!skill.content && skill.name) {
      skill.content = await providers.skills.load(skill.name) ?? undefined;
    }
  }

  const formatted = formatContext(enriched, {
    skipIdentities: true,
    maxSkillLength: 3000,
    maxSkills: 5,
    logger,
  });

  if (formatted) {
    process.stdout.write(JSON.stringify({ result: formatted }));
  }
  await logger.flush();
}

/** PreCompact — store compaction summary in memory before context is compressed */
async function handlePreCompact(event: Record<string, unknown>): Promise<void> {
  const workspaceRoot = (event.cwd as string) ?? process.cwd();

  try {
    const { providers, logger } = await initPipeline(workspaceRoot);

    const summary = (event.summary ?? event.content ?? '') as string;
    if (summary) {
      await providers.memory.store({
        content: `[compaction] ${summary.slice(0, 1000)}`,
        type: 'log',
        date: new Date().toISOString().slice(0, 10),
      });
    }
    await logger.flush();
  } catch (err) {
    process.stderr.write(`[dot-ai] pre-compact error: ${err}\n`);
  }
}

/** Stop — extract key decisions/facts from session and store in memory */
async function handleStop(event: Record<string, unknown>): Promise<void> {
  const workspaceRoot = (event.cwd as string) ?? process.cwd();

  try {
    const { providers, logger } = await initPipeline(workspaceRoot);

    const response = (event.response ?? event.content ?? '') as string;
    if (response) {
      await learn(response, providers);
    }
    await logger.flush();
  } catch (err) {
    process.stderr.write(`[dot-ai] stop error: ${err}\n`);
  }
}

/** PreToolUse — block writes to memory/*.md files (enforce SQLite-only memory) */
async function handlePreToolUse(event: Record<string, unknown>): Promise<void> {
  const toolName = (event.tool_name ?? '') as string;
  const input = (event.tool_input ?? {}) as Record<string, unknown>;

  // Only check Write and Edit tools
  if (toolName !== 'Write' && toolName !== 'Edit') return;

  const filePath = (input.file_path ?? input.path ?? '') as string;
  if (filePath && /memory\/.*\.md$/i.test(filePath)) {
    // Block the write — output rejection
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: 'Memory is managed by dot-ai SQLite provider. Do not write to memory/*.md files directly. Use the memory_store tool instead.',
    }));
  }
}

// ── Main dispatcher ──

async function main(): Promise<void> {
  const eventType = process.argv[2] ?? 'prompt-submit';

  let event: Record<string, unknown>;
  try {
    event = await readStdin();
  } catch {
    process.stderr.write('[dot-ai] Failed to parse stdin JSON\n');
    return;
  }

  try {
    switch (eventType) {
      case 'prompt-submit':
        await handlePromptSubmit(event);
        break;
      case 'pre-compact':
        await handlePreCompact(event);
        break;
      case 'stop':
        await handleStop(event);
        break;
      case 'pre-tool-use':
        await handlePreToolUse(event);
        break;
      default:
        process.stderr.write(`[dot-ai] Unknown event type: ${eventType}\n`);
    }
  } catch (err) {
    process.stderr.write(`[dot-ai] Error: ${err}\n`);
  }
}

main();
