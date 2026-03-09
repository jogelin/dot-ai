/**
 * IsolatedAgentEnv — creates a hermetic, throwaway agent home directory.
 *
 * Each agent stores its own config, plugins, and state in a "home" folder.
 * Running tests with the real home would:
 *   - Pollute ~/.ai/, ~/.openclaw/, ~/.pi/ etc.
 *   - Cause non-deterministic results depending on installed plugins
 *   - Create port/gateway conflicts for agents that run daemons
 *
 * This class creates a fresh temp directory per test and redirects each
 * agent's home via environment variables, keeping test runs hermetic.
 *
 * ─── What each tier tests ────────────────────────────────────────────────────
 *
 *  Tier 1 (unit tests) — no filesystem, no agents. 544 tests, ~1s.
 *    packages/core/src/__tests__/
 *    packages/adapter-X/src/__tests__/
 *
 *  Tier 2 (pipeline E2E) — real filesystem, real DotAiRuntime, ZERO agents.
 *    packages/e2e/scenarios/baseline/   ← validates what gets injected
 *    packages/e2e/scenarios/features/   ← red tests = implementation roadmap
 *    packages/e2e/scenarios/adapters/   ← formatted output per adapter
 *
 *  Tier 3 (subprocess / mock API) — isolated home, no live agent session.
 *    Spawn the adapter's hook.js as a subprocess with HOME = temp dir.
 *    OR call adapter with a mock agent API object.
 *    Still no real Claude Code / Pi / OpenClaw session needed.
 *
 * ─── What CANNOT be automated ────────────────────────────────────────────────
 *
 *  - Does the LLM actually *use* the injected context? → manual smoke test
 *  - OpenClaw gateway integration → Docker / dedicated CI (gateway daemon,
 *    custom port, isolated OPENCLAW_HOME)
 *  - Pi multi-turn context propagation → requires a real Pi session
 *
 * These are not test failures — they are outside the testing boundary.
 */
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGES_DIR = resolve(__dirname, '..', '..');

/**
 * Resolved paths to compiled extension dist files.
 * Use these in WorkspaceBuilder.withSettings() for hook-based tests.
 *
 * Example (Claude hook needs settings.json to know which extensions to load):
 *   WorkspaceBuilder.create()
 *     .withSkill(...)
 *     .withSettings({ extensions: { paths: [EXTENSION_DIST.skills] } })
 *     .build()
 */
export const EXTENSION_DIST = {
  skills:   resolve(PACKAGES_DIR, 'ext-file-skills',   'dist', 'index.js'),
  memory:   resolve(PACKAGES_DIR, 'ext-file-memory',   'dist', 'extension.js'),
  identity: resolve(PACKAGES_DIR, 'ext-file-identity', 'dist', 'index.js'),
} as const;

// ── Isolated home ─────────────────────────────────────────────────────────────

export class IsolatedAgentEnv {
  private constructor(public readonly home: string) {}

  static async create(): Promise<IsolatedAgentEnv> {
    const home = await mkdtemp(join(tmpdir(), 'dot-ai-agent-home-'));
    // Pre-create common agent home subdirs so agents don't fail on missing dirs
    await mkdir(join(home, '.ai'), { recursive: true });
    return new IsolatedAgentEnv(home);
  }

  /**
   * Environment variables for spawning a subprocess with this isolated home.
   * Overrides HOME and all known agent-specific home env vars.
   */
  get env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      HOME: this.home,
      // Per-agent home overrides — add new agents here as they are supported
      AI_HOME:        join(this.home, '.ai'),
      OPENCLAW_HOME:  join(this.home, '.openclaw'),
      // PI_HOME:     join(this.home, '.pi'),   // add when Pi supports it
    };
  }

  async cleanup(): Promise<void> {
    await rm(this.home, { recursive: true, force: true });
  }
}

// ── Claude hook invocation ────────────────────────────────────────────────────

export type ClaudeHookEvent =
  | 'session-start'
  | 'prompt-submit'
  | 'pre-compact'
  | 'stop'
  | 'pre-tool-use';

export interface ClaudeHookResult {
  /** Raw stdout from the hook process */
  stdout: string;
  /** Raw stderr from the hook process (diagnostic logs) */
  stderr: string;
  /** Process exit code */
  exitCode: number;
  /** Parsed JSON output if stdout is valid JSON, otherwise null */
  json: Record<string, unknown> | null;
  /** The "result" field from JSON output — the markdown injected into Claude */
  injectedContext: string | null;
}

/**
 * Invoke the Claude Code adapter hook.js as a real subprocess.
 *
 * Completely isolated:
 * - HOME is redirected to agentEnv.home (never touches ~/.claude/)
 * - Event JSON is piped to stdin (mimics how Claude Code calls the hook)
 * - Output is collected from stdout
 *
 * This tests the full adapter-claude path:
 *   event JSON → hook.js → DotAiRuntime → formatSections → stdout JSON
 *
 * No real Claude Code session needed.
 */
export async function invokeClaudeHook(
  eventType: ClaudeHookEvent,
  event: Record<string, unknown>,
  agentEnv: IsolatedAgentEnv,
): Promise<ClaudeHookResult> {
  const hookPath = resolve(PACKAGES_DIR, 'adapter-claude', 'dist', 'hook.js');
  const workspaceRoot = (event.cwd as string | undefined) ?? agentEnv.home;

  return new Promise((res, rej) => {
    // Use process.execPath (the actual running node binary) instead of 'node'
    // to avoid going through mise/nvm shims which may not resolve correctly
    // in subprocess environments.
    const proc = spawn(process.execPath, [hookPath, eventType], {
      env: agentEnv.env,
      cwd: workspaceRoot,
    });

    let stdout = '';
    let stderr = '';

    proc.stdin.write(JSON.stringify(event));
    proc.stdin.end();

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      let json: Record<string, unknown> | null = null;
      let injectedContext: string | null = null;

      if (stdout.trim()) {
        try {
          json = JSON.parse(stdout) as Record<string, unknown>;
          injectedContext = typeof json['result'] === 'string' ? json['result'] : null;
        } catch {
          // stdout is not JSON (hook can emit non-JSON in some paths)
        }
      }

      res({ stdout, stderr, exitCode: code ?? 0, json, injectedContext });
    });

    proc.on('error', rej);
  });
}

// ── Pi mock API ───────────────────────────────────────────────────────────────

/**
 * Events captured during a Pi mock session.
 * Inspect these after calling extension handlers to assert behavior.
 */
export interface PiMockCapture {
  registeredTools: Array<{ name: string; description: string }>;
  registeredCommands: Array<{ name: string }>;
  systemPromptFromBeforeAgentStart: string | null;
  modelFromBeforeAgentStart: string | null;
}

/**
 * A mock Pi extension API + session runner.
 *
 * Calls the dot-ai Pi adapter directly (no Pi process needed) and captures
 * what it registers and what systemPrompt it would inject.
 *
 * Tests the full adapter-pi path:
 *   mock Pi events → dotAiPiExtension() → DotAiRuntime → sections → systemPrompt
 *
 * Limitation: does NOT test Pi's native session lifecycle, tool invocation,
 * or multi-turn context. Those require a real Pi session.
 */
export async function runPiMockSession(
  workspaceRoot: string,
  prompt: string,
): Promise<PiMockCapture> {
  // Dynamically import the Pi adapter (avoids circular dep issues)
  const piAdapterPath = resolve(PACKAGES_DIR, 'adapter-pi', 'dist', 'index.js');
  const { default: dotAiPiExtension } = await import(piAdapterPath) as {
    default: (pi: PiMockAPI) => void
  };

  const capture: PiMockCapture = {
    registeredTools: [],
    registeredCommands: [],
    systemPromptFromBeforeAgentStart: null,
    modelFromBeforeAgentStart: null,
  };

  const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();

  const mockPi: PiMockAPI = {
    on(event: string, handler: (...args: unknown[]) => unknown) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    },
    registerTool(tool: { name: string; description: string }) {
      capture.registeredTools.push({ name: tool.name, description: tool.description });
    },
    registerCommand(cmd: { name: string }) {
      capture.registeredCommands.push({ name: cmd.name });
    },
  };

  // Boot the Pi extension (triggers session_start → DotAiRuntime.boot())
  dotAiPiExtension(mockPi);

  // Override workspaceRoot for test isolation
  process.chdir(workspaceRoot);

  // Trigger session_start
  const sessionStartHandlers = handlers.get('session_start') ?? [];
  for (const h of sessionStartHandlers) await h();

  // Trigger before_agent_start with the prompt
  const beforeHandlers = handlers.get('before_agent_start') ?? [];
  for (const h of beforeHandlers) {
    const result = await h({ content: prompt }) as { systemPrompt?: string; model?: string } | undefined;
    if (result?.systemPrompt) capture.systemPromptFromBeforeAgentStart = result.systemPrompt;
    if (result?.model) capture.modelFromBeforeAgentStart = result.model;
  }

  // Trigger session_shutdown
  const shutdownHandlers = handlers.get('session_shutdown') ?? [];
  for (const h of shutdownHandlers) await h();

  return capture;
}

interface PiMockAPI {
  on(event: string, handler: (...args: unknown[]) => unknown): void;
  registerTool(tool: { name: string; description: string; parameters: unknown; execute: unknown }): void;
  registerCommand?(cmd: { name: string; description: string }): void;
}
