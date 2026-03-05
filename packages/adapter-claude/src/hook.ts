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
  DotAiRuntime,
  NoopLogger,
  JsonFileLogger,
  loadConfig,
} from '@dot-ai/core';
import type { Logger } from '@dot-ai/core';

// ── Shared ──

async function readStdin(): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

async function createRuntime(workspaceRoot: string): Promise<DotAiRuntime> {
  const rawConfig = await loadConfig(workspaceRoot);
  const logPath = process.env.DOT_AI_LOG ?? rawConfig.debug?.logPath;
  const logger: Logger = logPath ? new JsonFileLogger(logPath) : new NoopLogger();

  const runtime = new DotAiRuntime({
    workspaceRoot,
    logger,
    skipIdentities: true,
    maxSkillLength: 3000,
    maxSkills: 5,
  });
  await runtime.boot();
  return runtime;
}

// ── Event handlers ──

async function handlePromptSubmit(event: Record<string, unknown>): Promise<DotAiRuntime | undefined> {
  const workspaceRoot = (event.cwd as string) ?? process.cwd();
  const runtime = await createRuntime(workspaceRoot);

  const prompt = (event.prompt ?? event.content ?? '') as string;
  if (!prompt) return runtime;

  const { formatted } = await runtime.processPrompt(prompt);
  if (formatted) {
    process.stdout.write(JSON.stringify({ result: formatted }));
  }
  return runtime;
}

async function handlePreCompact(event: Record<string, unknown>): Promise<DotAiRuntime | undefined> {
  const workspaceRoot = (event.cwd as string) ?? process.cwd();
  const runtime = await createRuntime(workspaceRoot);
  try {
    const summary = (event.summary ?? event.content ?? '') as string;
    if (summary && runtime.providers?.memory) {
      await runtime.providers.memory.store({
        content: `[compaction] ${summary.slice(0, 1000)}`,
        type: 'log',
        date: new Date().toISOString().slice(0, 10),
      });
    }
  } catch (err) {
    process.stderr.write(`[dot-ai] pre-compact error: ${err}\n`);
  }
  return runtime;
}

async function handleStop(event: Record<string, unknown>): Promise<DotAiRuntime | undefined> {
  const workspaceRoot = (event.cwd as string) ?? process.cwd();
  const runtime = await createRuntime(workspaceRoot);
  try {
    const response = (event.response ?? event.content ?? '') as string;
    if (response) {
      await runtime.learn(response);
    }
  } catch (err) {
    process.stderr.write(`[dot-ai] stop error: ${err}\n`);
  }
  return runtime;
}

async function handlePreToolUse(event: Record<string, unknown>): Promise<undefined> {
  const toolName = (event.tool_name ?? '') as string;
  const input = (event.tool_input ?? {}) as Record<string, unknown>;

  if (toolName === 'Write' || toolName === 'Edit') {
    const filePath = (input.file_path ?? input.path ?? '') as string;
    if (filePath && /memory\/[^\s]*\.md$/i.test(filePath)) {
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: 'Memory is managed by dot-ai SQLite provider. Use the memory_store tool instead.',
      }));
      return;
    }
  }

  if (toolName === 'Bash') {
    const command = (input.command ?? '') as string;
    if (/memory\/[^\s]*\.md/i.test(command) && /(?:>|tee|cp|mv|cat\s*<<|echo\s.*>)/i.test(command)) {
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: 'Memory is managed by dot-ai SQLite provider. Use the memory_store tool instead.',
      }));
    }
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

  let runtime: DotAiRuntime | undefined;
  try {
    switch (eventType) {
      case 'prompt-submit': runtime = await handlePromptSubmit(event); break;
      case 'pre-compact': runtime = await handlePreCompact(event); break;
      case 'stop': runtime = await handleStop(event); break;
      case 'pre-tool-use': await handlePreToolUse(event); break;
      default: process.stderr.write(`[dot-ai] Unknown event type: ${eventType}\n`);
    }
  } catch (err) {
    process.stderr.write(`[dot-ai] Error: ${err}\n`);
  }

  // Flush logger before process exit
  if (runtime) await runtime.flush();
}

main();
