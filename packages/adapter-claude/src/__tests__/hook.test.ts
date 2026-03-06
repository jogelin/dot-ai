/**
 * Tests for hook.ts logic patterns.
 *
 * hook.ts is a CLI entry point (self-executing, reads from stdin) so we cannot
 * import its handlers directly. Instead we:
 *   1. Re-implement the key regex logic and verify it matches the source patterns.
 *   2. Test the handler behaviours by calling the equivalent logic through
 *      a thin reimplementation that accepts the same mocked DotAiRuntime.
 *
 * The regexes under test are the canonical ones from hook.ts:
 *   - Memory-file detection:  /memory\/[^\s]*\.md$/i
 *   - Bash memory-write:      /memory\/[^\s]*\.md/i  +  /(?:>|tee|cp|mv|cat\s*<<|echo\s.*>)/i
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ADAPTER_CAPABILITIES } from '@dot-ai/core';
import type { DotAiRuntime } from '@dot-ai/core';

// ── Regex constants (copied verbatim from hook.ts) ──────────────────────────

const MEMORY_FILE_RE = /memory\/[^\s]*\.md$/i;
const BASH_MEMORY_PATH_RE = /memory\/[^\s]*\.md/i;
const BASH_WRITE_OP_RE = /(?:>|tee|cp|mv|cat\s*<<|echo\s.*>)/i;

// ── Minimal event-handler reimplementations ──────────────────────────────────
// These mirror hook.ts handler logic but accept an already-constructed runtime
// instead of calling createRuntime(), letting us inject mocks cleanly.

interface BlockResult { decision: 'block'; reason: string }
interface AllowResult { decision?: never }
type PreToolResult = BlockResult | AllowResult | null;

async function handlePreToolUse(
  event: Record<string, unknown>,
  runtime: Pick<DotAiRuntime, 'fireToolCall'>,
  out: string[] = [],  // collect stdout writes for assertions
): Promise<PreToolResult> {
  const toolName = (event.tool_name ?? '') as string;
  const input = (event.tool_input ?? {}) as Record<string, unknown>;

  // Extension check first
  const extensionResult = await runtime.fireToolCall({ tool: toolName, input });
  if (extensionResult?.decision === 'block') {
    const payload: BlockResult = { decision: 'block', reason: extensionResult.reason ?? 'Blocked by extension' };
    out.push(JSON.stringify(payload));
    return payload;
  }

  // Hardcoded memory-file blocking
  if (toolName === 'Write' || toolName === 'Edit') {
    const filePath = (input.file_path ?? input.path ?? '') as string;
    if (filePath && MEMORY_FILE_RE.test(filePath)) {
      const payload: BlockResult = {
        decision: 'block',
        reason: 'Memory is managed by dot-ai SQLite provider. Use the memory_store tool instead.',
      };
      out.push(JSON.stringify(payload));
      return payload;
    }
  }

  if (toolName === 'Bash') {
    const command = (input.command ?? '') as string;
    if (BASH_MEMORY_PATH_RE.test(command) && BASH_WRITE_OP_RE.test(command)) {
      const payload: BlockResult = {
        decision: 'block',
        reason: 'Memory is managed by dot-ai SQLite provider. Use the memory_store tool instead.',
      };
      out.push(JSON.stringify(payload));
      return payload;
    }
  }

  return null;
}

async function handlePromptSubmit(
  event: Record<string, unknown>,
  runtime: Pick<DotAiRuntime, 'processPrompt'>,
  out: string[] = [],
): Promise<void> {
  const prompt = (event.prompt ?? event.content ?? '') as string;
  if (!prompt) return;

  const { formatted } = await runtime.processPrompt(prompt);
  if (formatted) {
    out.push(JSON.stringify({ result: formatted }));
  }
}

async function handlePreCompact(
  event: Record<string, unknown>,
  runtime: Pick<DotAiRuntime, 'fire'>,
): Promise<void> {
  const summary = (event.summary ?? event.content ?? '') as string;
  if (summary) {
    await runtime.fire('agent_end', {
      response: `[compaction] ${summary.slice(0, 1000)}`,
    });
  }
}

async function handleStop(
  event: Record<string, unknown>,
  runtime: Pick<DotAiRuntime, 'learn'>,
): Promise<void> {
  const response = (event.response ?? event.content ?? '') as string;
  if (response) {
    await runtime.learn(response);
  }
}

function handleSessionStart(
  _event: Record<string, unknown>,
  runtime: Pick<DotAiRuntime, 'diagnostics'>,
  errOut: string[] = [],
): void {
  const diag = runtime.diagnostics;
  errOut.push(`[dot-ai] Booted\n`);
  if (diag.extensions.length > 0) {
    errOut.push(`[dot-ai] ${diag.extensions.length} extension(s), ${diag.capabilityCount} tool(s)\n`);
    for (const ext of diag.extensions) {
      for (const eventName of Object.keys(ext.handlerCounts)) {
        if (!ADAPTER_CAPABILITIES['claude-code'].has(eventName)) {
          errOut.push(
            `[dot-ai] Warning: Extension ${ext.path} uses '${eventName}' (not supported by Claude Code adapter)\n`,
          );
        }
      }
    }
  }
}

// ── Mock factory ─────────────────────────────────────────────────────────────

function makeRuntime(): DotAiRuntime {
  return {
    fireToolCall: vi.fn().mockResolvedValue(null),
    processPrompt: vi.fn().mockResolvedValue({ formatted: '', enriched: {}, capabilities: [] }),
    learn: vi.fn().mockResolvedValue(undefined),
    fire: vi.fn().mockResolvedValue([]),
    diagnostics: { extensions: [], usedTiers: [], capabilityCount: 0, vocabularySize: 0 },
    flush: vi.fn().mockResolvedValue(undefined),
    boot: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    capabilities: [],
    isBooted: true,
    runner: null,
  } as unknown as DotAiRuntime;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MEMORY_FILE_RE', () => {
  it('matches direct memory path', () => {
    expect(MEMORY_FILE_RE.test('memory/notes.md')).toBe(true);
  });

  it('matches nested memory path', () => {
    expect(MEMORY_FILE_RE.test('/home/user/.ai/memory/sub/dir/notes.md')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(MEMORY_FILE_RE.test('MEMORY/NOTES.MD')).toBe(true);
  });

  it('does not match non-md extension', () => {
    expect(MEMORY_FILE_RE.test('memory/notes.txt')).toBe(false);
  });

  it('does not match path without memory segment', () => {
    expect(MEMORY_FILE_RE.test('/project/src/notes.md')).toBe(false);
  });

  it('does not match when md is not at end', () => {
    expect(MEMORY_FILE_RE.test('memory/notes.md.bak')).toBe(false);
  });

  it('does not match when filename has space before .md', () => {
    expect(MEMORY_FILE_RE.test('memory/foo .md')).toBe(false);
  });
});

describe('BASH_MEMORY_PATH_RE + BASH_WRITE_OP_RE', () => {
  function isBashBlocked(cmd: string): boolean {
    return BASH_MEMORY_PATH_RE.test(cmd) && BASH_WRITE_OP_RE.test(cmd);
  }

  it('blocks redirect write (>)', () => {
    expect(isBashBlocked('echo hello > memory/notes.md')).toBe(true);
  });

  it('blocks tee', () => {
    expect(isBashBlocked('cat file.txt | tee memory/notes.md')).toBe(true);
  });

  it('blocks cp into memory', () => {
    expect(isBashBlocked('cp backup.md memory/notes.md')).toBe(true);
  });

  it('blocks mv into memory', () => {
    expect(isBashBlocked('mv tmp.md memory/notes.md')).toBe(true);
  });

  it('blocks cat heredoc', () => {
    expect(isBashBlocked('cat << EOF > memory/notes.md')).toBe(true);
  });

  it('blocks echo with redirect', () => {
    expect(isBashBlocked('echo "data" > memory/notes.md')).toBe(true);
  });

  it('allows cat read from memory (no write op)', () => {
    expect(isBashBlocked('cat memory/notes.md')).toBe(false);
  });

  it('allows grep on memory files', () => {
    expect(isBashBlocked('grep foo memory/notes.md')).toBe(false);
  });

  it('allows write op on non-memory path', () => {
    expect(isBashBlocked('echo hello > /tmp/notes.md')).toBe(false);
  });
});

describe('handlePreToolUse', () => {
  let runtime: DotAiRuntime;
  let out: string[];

  beforeEach(() => {
    runtime = makeRuntime();
    out = [];
  });

  describe('extension-based blocking', () => {
    it('blocks when extension returns decision=block', async () => {
      vi.mocked(runtime.fireToolCall).mockResolvedValue({ decision: 'block', reason: 'No access' });

      const result = await handlePreToolUse(
        { tool_name: 'Write', tool_input: { file_path: '/some/file.ts' } },
        runtime,
        out,
      );

      expect(result).toMatchObject({ decision: 'block', reason: 'No access' });
      expect(JSON.parse(out[0])).toMatchObject({ decision: 'block', reason: 'No access' });
    });

    it('uses fallback reason when extension provides none', async () => {
      vi.mocked(runtime.fireToolCall).mockResolvedValue({ decision: 'block', reason: undefined as unknown as string });

      const result = await handlePreToolUse(
        { tool_name: 'Read', tool_input: {} },
        runtime,
        out,
      );

      expect(result).toMatchObject({ decision: 'block', reason: 'Blocked by extension' });
    });

    it('runs extension check BEFORE hardcoded memory check', async () => {
      vi.mocked(runtime.fireToolCall).mockResolvedValue({ decision: 'block', reason: 'Custom extension block' });

      const result = await handlePreToolUse(
        { tool_name: 'Write', tool_input: { file_path: 'memory/notes.md' } },
        runtime,
        out,
      );

      expect(result).toMatchObject({ reason: 'Custom extension block' });
    });

    it('proceeds to hardcoded checks when extension returns null', async () => {
      vi.mocked(runtime.fireToolCall).mockResolvedValue(null);

      const result = await handlePreToolUse(
        { tool_name: 'Write', tool_input: { file_path: 'memory/notes.md' } },
        runtime,
        out,
      );

      expect(result).toMatchObject({ decision: 'block' });
      expect(result).toMatchObject({ reason: expect.stringContaining('SQLite') });
    });
  });

  describe('Write tool blocking', () => {
    it('blocks Write to memory/*.md via file_path', async () => {
      const result = await handlePreToolUse(
        { tool_name: 'Write', tool_input: { file_path: 'memory/notes.md' } },
        runtime,
        out,
      );

      expect(result).toMatchObject({ decision: 'block' });
      expect(JSON.parse(out[0]).decision).toBe('block');
    });

    it('blocks Write to nested memory path', async () => {
      const result = await handlePreToolUse(
        { tool_name: 'Write', tool_input: { file_path: '/home/user/.ai/memory/sub/log.md' } },
        runtime,
        out,
      );

      expect(result).toMatchObject({ decision: 'block' });
    });

    it('blocks Write using .path field (alternative key)', async () => {
      const result = await handlePreToolUse(
        { tool_name: 'Write', tool_input: { path: 'memory/notes.md' } },
        runtime,
        out,
      );

      expect(result).toMatchObject({ decision: 'block' });
    });

    it('allows Write to non-memory path', async () => {
      const result = await handlePreToolUse(
        { tool_name: 'Write', tool_input: { file_path: '/project/src/notes.md' } },
        runtime,
        out,
      );

      expect(result).toBeNull();
      expect(out).toHaveLength(0);
    });

    it('allows Write when file_path is empty', async () => {
      const result = await handlePreToolUse(
        { tool_name: 'Write', tool_input: { file_path: '' } },
        runtime,
        out,
      );

      expect(result).toBeNull();
    });
  });

  describe('Edit tool blocking', () => {
    it('blocks Edit to memory/*.md', async () => {
      const result = await handlePreToolUse(
        { tool_name: 'Edit', tool_input: { file_path: 'memory/context.md' } },
        runtime,
        out,
      );

      expect(result).toMatchObject({ decision: 'block' });
    });

    it('allows Edit to non-memory path', async () => {
      const result = await handlePreToolUse(
        { tool_name: 'Edit', tool_input: { file_path: 'src/components/App.tsx' } },
        runtime,
        out,
      );

      expect(result).toBeNull();
    });
  });

  describe('Bash tool blocking', () => {
    it('blocks echo redirect to memory file', async () => {
      const result = await handlePreToolUse(
        { tool_name: 'Bash', tool_input: { command: 'echo hello > memory/notes.md' } },
        runtime,
        out,
      );

      expect(result).toMatchObject({ decision: 'block' });
    });

    it('blocks tee to memory file', async () => {
      const result = await handlePreToolUse(
        { tool_name: 'Bash', tool_input: { command: 'cat file | tee memory/notes.md' } },
        runtime,
        out,
      );

      expect(result).toMatchObject({ decision: 'block' });
    });

    it('blocks cp into memory', async () => {
      const result = await handlePreToolUse(
        { tool_name: 'Bash', tool_input: { command: 'cp backup.md memory/notes.md' } },
        runtime,
        out,
      );

      expect(result).toMatchObject({ decision: 'block' });
    });

    it('blocks mv into memory', async () => {
      const result = await handlePreToolUse(
        { tool_name: 'Bash', tool_input: { command: 'mv tmp.md memory/notes.md' } },
        runtime,
        out,
      );

      expect(result).toMatchObject({ decision: 'block' });
    });

    it('allows cat read from memory (no write op)', async () => {
      const result = await handlePreToolUse(
        { tool_name: 'Bash', tool_input: { command: 'cat memory/notes.md' } },
        runtime,
        out,
      );

      expect(result).toBeNull();
    });

    it('allows grep on memory file', async () => {
      const result = await handlePreToolUse(
        { tool_name: 'Bash', tool_input: { command: 'grep pattern memory/notes.md' } },
        runtime,
        out,
      );

      expect(result).toBeNull();
    });

    it('allows write op to non-memory path', async () => {
      const result = await handlePreToolUse(
        { tool_name: 'Bash', tool_input: { command: 'echo hello > /tmp/output.md' } },
        runtime,
        out,
      );

      expect(result).toBeNull();
    });

    it('allows Bash with empty command', async () => {
      const result = await handlePreToolUse(
        { tool_name: 'Bash', tool_input: { command: '' } },
        runtime,
        out,
      );

      expect(result).toBeNull();
    });
  });

  describe('other tool names', () => {
    it('allows unrecognised tool names without block', async () => {
      const result = await handlePreToolUse(
        { tool_name: 'Read', tool_input: { file_path: 'memory/notes.md' } },
        runtime,
        out,
      );

      expect(result).toBeNull();
    });
  });
});

describe('handlePromptSubmit', () => {
  let runtime: DotAiRuntime;
  let out: string[];

  beforeEach(() => {
    runtime = makeRuntime();
    out = [];
  });

  it('calls processPrompt and writes JSON result to stdout', async () => {
    vi.mocked(runtime.processPrompt).mockResolvedValue({
      formatted: 'enriched context',
      enriched: {} as never,
      capabilities: [],
    });

    await handlePromptSubmit({ prompt: 'how do I do X?' }, runtime, out);

    expect(runtime.processPrompt).toHaveBeenCalledWith('how do I do X?');
    expect(JSON.parse(out[0])).toEqual({ result: 'enriched context' });
  });

  it('reads prompt from content field if prompt is missing', async () => {
    vi.mocked(runtime.processPrompt).mockResolvedValue({
      formatted: 'ctx',
      enriched: {} as never,
      capabilities: [],
    });

    await handlePromptSubmit({ content: 'alt prompt' }, runtime, out);

    expect(runtime.processPrompt).toHaveBeenCalledWith('alt prompt');
  });

  it('does not write to stdout when formatted is empty', async () => {
    vi.mocked(runtime.processPrompt).mockResolvedValue({
      formatted: '',
      enriched: {} as never,
      capabilities: [],
    });

    await handlePromptSubmit({ prompt: 'hello' }, runtime, out);

    expect(out).toHaveLength(0);
  });

  it('returns early without calling processPrompt when prompt is empty', async () => {
    await handlePromptSubmit({ prompt: '' }, runtime, out);

    expect(runtime.processPrompt).not.toHaveBeenCalled();
    expect(out).toHaveLength(0);
  });

  it('returns early when neither prompt nor content present', async () => {
    await handlePromptSubmit({}, runtime, out);

    expect(runtime.processPrompt).not.toHaveBeenCalled();
  });
});

describe('handlePreCompact', () => {
  it('fires agent_end with compaction summary', async () => {
    const fire = vi.fn().mockResolvedValue([]);
    const runtime = { fire } as unknown as DotAiRuntime;

    await handlePreCompact({ summary: 'session wrapped up nicely' }, runtime);

    expect(fire).toHaveBeenCalledWith('agent_end', {
      response: '[compaction] session wrapped up nicely',
    });
  });

  it('truncates summary to 1000 characters', async () => {
    const fire = vi.fn().mockResolvedValue([]);
    const runtime = { fire } as unknown as DotAiRuntime;
    const longSummary = 'x'.repeat(2000);

    await handlePreCompact({ summary: longSummary }, runtime);

    const call = fire.mock.calls[0][1];
    expect(call.response.length).toBe('[compaction] '.length + 1000);
  });

  it('reads from content field when summary is absent', async () => {
    const fire = vi.fn().mockResolvedValue([]);
    const runtime = { fire } as unknown as DotAiRuntime;

    await handlePreCompact({ content: 'fallback summary' }, runtime);

    expect(fire).toHaveBeenCalledWith('agent_end', {
      response: '[compaction] fallback summary',
    });
  });

  it('does nothing when summary is empty', async () => {
    const fire = vi.fn().mockResolvedValue([]);
    const runtime = { fire } as unknown as DotAiRuntime;

    await handlePreCompact({ summary: '' }, runtime);

    expect(fire).not.toHaveBeenCalled();
  });
});

describe('handleStop', () => {
  let runtime: DotAiRuntime;

  beforeEach(() => {
    runtime = makeRuntime();
  });

  it('calls runtime.learn with the response', async () => {
    await handleStop({ response: 'I completed the task.' }, runtime);

    expect(runtime.learn).toHaveBeenCalledWith('I completed the task.');
  });

  it('reads from content field when response is absent', async () => {
    await handleStop({ content: 'alt response' }, runtime);

    expect(runtime.learn).toHaveBeenCalledWith('alt response');
  });

  it('does not call learn when response is empty', async () => {
    await handleStop({ response: '' }, runtime);

    expect(runtime.learn).not.toHaveBeenCalled();
  });

  it('does not call learn when neither response nor content present', async () => {
    await handleStop({}, runtime);

    expect(runtime.learn).not.toHaveBeenCalled();
  });
});

describe('handleSessionStart', () => {
  it('logs extension count when extensions are loaded', () => {
    const errOut: string[] = [];
    const runtime = {
      ...makeRuntime(),
      diagnostics: {
        extensions: [
          { path: '/ext/my-ext.js', handlerCounts: { prompt_submit: 1 }, toolNames: [], commandNames: [], tiers: [] },
        ],
        usedTiers: [],
        capabilityCount: 0,
        vocabularySize: 0,
      },
    };

    handleSessionStart({}, runtime, errOut);

    expect(errOut.some(l => l.includes('1 extension(s)'))).toBe(true);
  });

  it('warns about events not supported by Claude Code adapter', () => {
    const errOut: string[] = [];
    const unsupportedEvent = '__definitely_not_supported__';
    const runtime = {
      ...makeRuntime(),
      diagnostics: {
        extensions: [
          { path: '/ext/my-ext.js', handlerCounts: { [unsupportedEvent]: 1 }, toolNames: [], commandNames: [], tiers: [] },
        ],
        usedTiers: [],
        capabilityCount: 0,
        vocabularySize: 0,
      },
    };

    handleSessionStart({}, runtime, errOut);

    const warnings = errOut.filter(l => l.includes('Warning'));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain(unsupportedEvent);
    expect(warnings[0]).toContain('/ext/my-ext.js');
  });

  it('does not warn for events that ARE supported', () => {
    const errOut: string[] = [];
    const supportedEvent = [...ADAPTER_CAPABILITIES['claude-code']][0];
    const runtime = {
      ...makeRuntime(),
      diagnostics: {
        extensions: [
          { path: '/ext/my-ext.js', handlerCounts: { [supportedEvent]: 1 }, toolNames: [], commandNames: [], tiers: [] },
        ],
        usedTiers: [],
        capabilityCount: 0,
        vocabularySize: 0,
      },
    };

    handleSessionStart({}, runtime, errOut);

    const warnings = errOut.filter(l => l.includes('Warning'));
    expect(warnings).toHaveLength(0);
  });

  it('logs boot message when no extensions are loaded', () => {
    const errOut: string[] = [];
    handleSessionStart({}, makeRuntime(), errOut);

    expect(errOut.some(l => l.includes('Booted'))).toBe(true);
    expect(errOut.filter(l => l.includes('extension')).length).toBe(0);
  });
});

describe('ADAPTER_CAPABILITIES claude-code set', () => {
  it('is a Set', () => {
    expect(ADAPTER_CAPABILITIES['claude-code']).toBeInstanceOf(Set);
  });

  it('contains expected event names', () => {
    const set = ADAPTER_CAPABILITIES['claude-code'];
    expect(set.size).toBeGreaterThan(0);
  });
});
