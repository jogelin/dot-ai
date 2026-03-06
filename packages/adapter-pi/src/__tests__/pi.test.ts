import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @dot-ai/core before importing the adapter
const mockRuntime = {
  boot: vi.fn().mockResolvedValue(undefined),
  processPrompt: vi.fn().mockResolvedValue({ formatted: 'test context', enriched: {}, capabilities: [] }),
  learn: vi.fn().mockResolvedValue(undefined),
  fire: vi.fn().mockResolvedValue([]),
  fireToolCall: vi.fn().mockResolvedValue(null),
  shutdown: vi.fn().mockResolvedValue(undefined),
  capabilities: [
    {
      name: 'memory_recall',
      description: 'Search memory',
      parameters: { query: { type: 'string' } },
      promptSnippet: 'Use memory_recall to search',
      promptGuidelines: 'Search before answering',
      execute: vi.fn().mockResolvedValue({ text: 'memory result', details: { hits: 1 } }),
    },
  ],
  diagnostics: { extensions: [], usedTiers: [], providerStatus: {}, capabilityCount: 1 },
  isBooted: true,
};

vi.mock('@dot-ai/core', () => {
  // Use a class so `new DotAiRuntime()` works correctly
  const MockDotAiRuntime = vi.fn(function (this: unknown) {
    return mockRuntime;
  });
  return {
    DotAiRuntime: MockDotAiRuntime,
  };
});

import dotAiPiExtension from '../index.js';
import { DotAiRuntime } from '@dot-ai/core';

// Helper to create a mock Pi API and capture handlers
function createMockPi() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const mockPi = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(event, handler);
    }),
    registerTool: vi.fn(),
  };
  return { mockPi, handlers };
}

describe('adapter-pi', () => {
  // --- Registration tests (existing) ---

  it('exports a default function', () => {
    expect(typeof dotAiPiExtension).toBe('function');
  });

  it('registers event handlers on pi API', () => {
    const { mockPi } = createMockPi();
    dotAiPiExtension(mockPi);

    expect(mockPi.on).toHaveBeenCalledWith('session_start', expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith('before_agent_start', expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith('context', expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith('tool_call', expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith('tool_result', expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith('agent_end', expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith('session_shutdown', expect.any(Function));
  });

  it('registers all expected pi events', () => {
    const events: string[] = [];
    const mockPi = {
      on: vi.fn((event: string) => events.push(event)),
      registerTool: vi.fn(),
    };

    dotAiPiExtension(mockPi);

    const expected = ['session_start', 'before_agent_start', 'context', 'tool_call', 'tool_result', 'agent_end', 'session_shutdown'];
    for (const e of expected) {
      expect(events).toContain(e);
    }
  });

  // --- Handler behavior tests ---

  describe('handler behavior', () => {
    let handlers: Map<string, (...args: unknown[]) => unknown>;
    let mockPi: ReturnType<typeof createMockPi>['mockPi'];

    beforeEach(() => {
      // Reset all mocks before each test group setup
      vi.clearAllMocks();

      const setup = createMockPi();
      mockPi = setup.mockPi;
      handlers = setup.handlers;

      dotAiPiExtension(mockPi);
    });

    // --- session_start ---

    describe('session_start handler', () => {
      it('creates DotAiRuntime with cwd as workspaceRoot', async () => {
        const handler = handlers.get('session_start')!;
        await handler();

        expect(DotAiRuntime).toHaveBeenCalledWith({
          workspaceRoot: process.cwd(),
          skipIdentities: true,
        });
      });

      it('boots the runtime', async () => {
        const handler = handlers.get('session_start')!;
        await handler();

        expect(mockRuntime.boot).toHaveBeenCalled();
      });

      it('registers capabilities as pi tools via registerTool', async () => {
        const handler = handlers.get('session_start')!;
        await handler();

        expect(mockPi.registerTool).toHaveBeenCalledTimes(1);
        expect(mockPi.registerTool).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'memory_recall',
            description: 'Search memory',
            parameters: { query: { type: 'string' } },
            promptSnippet: 'Use memory_recall to search',
            promptGuidelines: 'Search before answering',
            execute: expect.any(Function),
          })
        );
      });

      it('maps capability execute to return {content, details} shape', async () => {
        const handler = handlers.get('session_start')!;
        await handler();

        const registeredTool = mockPi.registerTool.mock.calls[0][0] as {
          execute: (input: Record<string, unknown>) => Promise<{ content: string; details?: unknown }>;
        };

        const result = await registeredTool.execute({ query: 'test' });

        expect(result).toEqual({ content: 'memory result', details: { hits: 1 } });
        expect(mockRuntime.capabilities[0].execute).toHaveBeenCalledWith({ query: 'test' });
      });
    });

    // --- before_agent_start ---

    describe('before_agent_start handler', () => {
      it('returns undefined when runtime is null (before session_start)', async () => {
        // Use a fresh Pi instance without calling session_start
        const { handlers: freshHandlers } = createMockPi();
        const freshMockPi = { on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => freshHandlers.set(event, handler)), registerTool: vi.fn() };
        // We need a fresh module state — since module-level runtime starts null, just use a new registration
        // but same module, so runtime is whatever state it's in.
        // Instead, test via the shutdown path to reset runtime to null.
        const shutdownHandler = handlers.get('session_shutdown')!;
        await shutdownHandler();

        const handler = handlers.get('before_agent_start')!;
        const result = await handler({ content: 'hello' });
        expect(result).toBeUndefined();
      });

      it('calls runtime.processPrompt with message content and returns systemPrompt', async () => {
        // Boot the runtime first
        await handlers.get('session_start')!();

        const handler = handlers.get('before_agent_start')!;
        const result = await handler({ content: 'What is the weather?' });

        expect(mockRuntime.processPrompt).toHaveBeenCalledWith('What is the weather?');
        expect(result).toEqual({ systemPrompt: 'test context' });
      });

      it('passes empty string when content field is missing', async () => {
        await handlers.get('session_start')!();

        const handler = handlers.get('before_agent_start')!;
        await handler({});

        expect(mockRuntime.processPrompt).toHaveBeenCalledWith('');
      });

      it('passes empty string when arg is undefined', async () => {
        await handlers.get('session_start')!();

        const handler = handlers.get('before_agent_start')!;
        await handler(undefined);

        expect(mockRuntime.processPrompt).toHaveBeenCalledWith('');
      });
    });

    // --- context ---

    describe('context handler', () => {
      it('returns undefined when runtime is null', async () => {
        const shutdownHandler = handlers.get('session_shutdown')!;
        await shutdownHandler();

        const handler = handlers.get('context')!;
        const result = await handler({ messages: [{ role: 'user', content: 'hi' }] });
        expect(result).toBeUndefined();
      });

      it('fires context_modify event with messages and returns first result', async () => {
        const modifierResult = { messages: [{ role: 'system', content: 'injected' }] };
        mockRuntime.fire.mockResolvedValueOnce([modifierResult]);

        await handlers.get('session_start')!();

        const event = { messages: [{ role: 'user', content: 'hi' }] };
        const handler = handlers.get('context')!;
        const result = await handler(event);

        expect(mockRuntime.fire).toHaveBeenCalledWith('context_modify', event);
        expect(result).toBe(modifierResult);
      });

      it('returns undefined when fire returns empty results', async () => {
        mockRuntime.fire.mockResolvedValueOnce([]);

        await handlers.get('session_start')!();

        const handler = handlers.get('context')!;
        const result = await handler({ messages: [{ role: 'user', content: 'hi' }] });

        expect(result).toBeUndefined();
      });

      it('skips fire call when messages are missing', async () => {
        await handlers.get('session_start')!();

        const handler = handlers.get('context')!;
        const result = await handler({});

        expect(mockRuntime.fire).not.toHaveBeenCalled();
        expect(result).toBeUndefined();
      });
    });

    // --- tool_call ---

    describe('tool_call handler', () => {
      it('returns undefined when runtime is null', async () => {
        const shutdownHandler = handlers.get('session_shutdown')!;
        await shutdownHandler();

        const handler = handlers.get('tool_call')!;
        const result = await handler({ tool: 'memory_recall', input: { query: 'test' } });
        expect(result).toBeUndefined();
      });

      it('calls runtime.fireToolCall with tool name and input', async () => {
        await handlers.get('session_start')!();

        const handler = handlers.get('tool_call')!;
        await handler({ tool: 'memory_recall', input: { query: 'test' } });

        expect(mockRuntime.fireToolCall).toHaveBeenCalledWith({
          tool: 'memory_recall',
          input: { query: 'test' },
        });
      });

      it('returns block result when extension blocks the tool call', async () => {
        const blockResult = { decision: 'block', reason: 'forbidden tool' };
        mockRuntime.fireToolCall.mockResolvedValueOnce(blockResult);

        await handlers.get('session_start')!();

        const handler = handlers.get('tool_call')!;
        const result = await handler({ tool: 'memory_recall', input: {} });

        expect(result).toBe(blockResult);
      });

      it('returns undefined when tool call is allowed (no block)', async () => {
        mockRuntime.fireToolCall.mockResolvedValueOnce({ decision: 'allow' });

        await handlers.get('session_start')!();

        const handler = handlers.get('tool_call')!;
        const result = await handler({ tool: 'memory_recall', input: {} });

        expect(result).toBeUndefined();
      });

      it('uses empty object for input when input field is missing', async () => {
        await handlers.get('session_start')!();

        const handler = handlers.get('tool_call')!;
        await handler({ tool: 'memory_recall' });

        expect(mockRuntime.fireToolCall).toHaveBeenCalledWith({
          tool: 'memory_recall',
          input: {},
        });
      });

      it('skips fireToolCall when tool field is missing', async () => {
        await handlers.get('session_start')!();

        const handler = handlers.get('tool_call')!;
        await handler({ input: {} });

        expect(mockRuntime.fireToolCall).not.toHaveBeenCalled();
      });
    });

    // --- tool_result ---

    describe('tool_result handler', () => {
      it('fires tool_result event with tool info', async () => {
        await handlers.get('session_start')!();

        const handler = handlers.get('tool_result')!;
        await handler({ tool: 'memory_recall', result: { content: 'some result' }, isError: false });

        expect(mockRuntime.fire).toHaveBeenCalledWith('tool_result', {
          tool: 'memory_recall',
          result: { content: 'some result' },
          isError: false,
        });
      });

      it('uses defaults for missing result and isError fields', async () => {
        await handlers.get('session_start')!();

        const handler = handlers.get('tool_result')!;
        await handler({ tool: 'memory_recall' });

        expect(mockRuntime.fire).toHaveBeenCalledWith('tool_result', {
          tool: 'memory_recall',
          result: { content: '' },
          isError: false,
        });
      });

      it('skips fire when tool field is missing', async () => {
        await handlers.get('session_start')!();

        const handler = handlers.get('tool_result')!;
        await handler({ result: { content: 'orphan result' } });

        expect(mockRuntime.fire).not.toHaveBeenCalled();
      });

      it('returns undefined when runtime is null', async () => {
        const shutdownHandler = handlers.get('session_shutdown')!;
        await shutdownHandler();

        const handler = handlers.get('tool_result')!;
        const result = await handler({ tool: 'memory_recall', result: { content: 'x' } });
        expect(result).toBeUndefined();
      });
    });

    // --- agent_end ---

    describe('agent_end handler', () => {
      it('calls runtime.learn with response text', async () => {
        await handlers.get('session_start')!();

        const handler = handlers.get('agent_end')!;
        await handler({ response: 'The answer is 42.' });

        expect(mockRuntime.learn).toHaveBeenCalledWith('The answer is 42.');
      });

      it('skips learn when response is empty string', async () => {
        await handlers.get('session_start')!();

        const handler = handlers.get('agent_end')!;
        await handler({ response: '' });

        expect(mockRuntime.learn).not.toHaveBeenCalled();
      });

      it('skips learn when response field is missing', async () => {
        await handlers.get('session_start')!();

        const handler = handlers.get('agent_end')!;
        await handler({});

        expect(mockRuntime.learn).not.toHaveBeenCalled();
      });

      it('returns undefined when runtime is null', async () => {
        const shutdownHandler = handlers.get('session_shutdown')!;
        await shutdownHandler();

        const handler = handlers.get('agent_end')!;
        const result = await handler({ response: 'some response' });
        expect(result).toBeUndefined();
        expect(mockRuntime.learn).not.toHaveBeenCalled();
      });
    });

    // --- session_shutdown ---

    describe('session_shutdown handler', () => {
      it('calls runtime.shutdown', async () => {
        await handlers.get('session_start')!();

        const handler = handlers.get('session_shutdown')!;
        await handler();

        expect(mockRuntime.shutdown).toHaveBeenCalled();
      });

      it('sets runtime to null after shutdown (subsequent handlers return undefined)', async () => {
        await handlers.get('session_start')!();
        await handlers.get('session_shutdown')!();

        // After shutdown, before_agent_start should return undefined (no runtime)
        const result = await handlers.get('before_agent_start')!({ content: 'hello' });
        expect(result).toBeUndefined();
        expect(mockRuntime.processPrompt).not.toHaveBeenCalled();
      });

      it('does nothing when runtime is already null', async () => {
        // Do not call session_start — runtime is null from previous shutdown or fresh state
        // Ensure we start from null by calling shutdown twice
        await handlers.get('session_start')!();
        await handlers.get('session_shutdown')!();

        vi.clearAllMocks();

        const handler = handlers.get('session_shutdown')!;
        await handler(); // Should not throw

        expect(mockRuntime.shutdown).not.toHaveBeenCalled();
      });
    });
  });
});
