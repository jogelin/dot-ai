/**
 * dot-ai Pi adapter — a pi-coding-agent extension.
 *
 * This IS a pi extension: export default function(pi: PiExtensionAPI)
 * Bridges dot-ai's runtime to pi's extension API.
 * Full fidelity — all tiers supported, zero degradation.
 */
import { DotAiRuntime, formatSections } from '@dot-ai/core';

// Pi extension API types (structural — no runtime dep on pi)
interface PiExtensionAPI {
  on(event: string, handler: (...args: unknown[]) => unknown): void;
  registerTool(tool: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute(input: Record<string, unknown>): Promise<{ content: string; details?: unknown }>;
    promptSnippet?: string;
    promptGuidelines?: string;
  }): void;
  registerCommand?(command: {
    name: string;
    description: string;
    parameters?: Array<{ name: string; description: string; required?: boolean }>;
    execute(args: Record<string, string>): Promise<{ output?: string } | void>;
    completions?(prefix: string): string[] | Promise<string[]>;
  }): void;
}

let runtime: DotAiRuntime | null = null;

export default function dotAiPiExtension(pi: PiExtensionAPI): void {
  pi.on('session_start', async () => {
    const workspaceRoot = process.cwd();
    runtime = new DotAiRuntime({
      workspaceRoot,
    });
    await runtime.boot();

    // Register capabilities as pi tools
    for (const cap of runtime.capabilities) {
      pi.registerTool({
        name: cap.name,
        description: cap.description,
        parameters: cap.parameters,
        promptSnippet: cap.promptSnippet,
        promptGuidelines: cap.promptGuidelines,
        async execute(input: Record<string, unknown>) {
          const result = await cap.execute(input);
          return { content: result.text, details: result.details };
        },
      });
    }

    // Register extension-contributed commands as pi commands
    if (pi.registerCommand) {
      for (const cmd of runtime.commands) {
        const cmdDef = cmd;
        pi.registerCommand({
          name: cmdDef.name,
          description: cmdDef.description,
          parameters: cmdDef.parameters,
          async execute(args: Record<string, string>) {
            const ctx = {
              workspaceRoot: process.cwd(),
              events: { on: () => {}, off: () => {}, emit: () => {} },
            };
            const result = await cmdDef.execute(args, ctx);
            return result ?? undefined;
          },
          completions: cmdDef.completions,
        });
      }
    }

    // Log diagnostics
    const diag = runtime.diagnostics;
    if (diag.extensions.length > 0) {
      process.stderr.write(`[dot-ai/pi] ${diag.extensions.length} extension(s) loaded\n`);
    }
  });

  pi.on('before_agent_start', async (...args: unknown[]) => {
    if (!runtime) return;
    const lastMessage = args[0] as { content?: string } | undefined;
    const prompt = lastMessage?.content ?? '';
    const result = await runtime.processPrompt(prompt);
    const formatted = formatSections(result.sections);
    const response: { systemPrompt: string; model?: string } = { systemPrompt: formatted };
    // If routing suggests a model change, propagate it to Pi
    if (result.routing?.model && result.routing.model !== 'default') {
      response.model = result.routing.model;
    }
    return response;
  });

  pi.on('tool_call', async (...args: unknown[]) => {
    if (!runtime) return;
    const event = args[0] as { tool?: string; input?: Record<string, unknown> } | undefined;
    if (event?.tool) {
      const result = await runtime.fireToolCall({
        tool: event.tool,
        input: event.input ?? {},
      });
      if (result?.decision === 'block') {
        return result;
      }
    }
  });

  pi.on('tool_result', async (...args: unknown[]) => {
    if (!runtime) return;
    const event = args[0] as { tool?: string; result?: { content: string }; isError?: boolean } | undefined;
    if (event?.tool) {
      await runtime.fire('tool_result', {
        tool: event.tool,
        result: event.result ?? { content: '' },
        isError: event.isError ?? false,
      });
    }
  });

  pi.on('turn_start', async (...args: unknown[]) => {
    if (!runtime) return;
    await runtime.fire('turn_start', args[0]);
  });

  pi.on('turn_end', async (...args: unknown[]) => {
    if (!runtime) return;
    await runtime.fire('turn_end', args[0]);
  });

  pi.on('agent_start', async (...args: unknown[]) => {
    if (!runtime) return;
    await runtime.fire('agent_start', args[0]);
  });

  // input: chain-transform — allows extensions to intercept/modify user input
  pi.on('input', async (...args: unknown[]) => {
    if (!runtime) return;
    const event = args[0] as { input?: string } | undefined;
    const input = event?.input ?? '';
    if (!input) return;
    // Fire as chain-transform: each extension may modify the input string
    const results = await runtime.fire<{ input?: string; consumed?: boolean }>('input', { input });
    // Apply transforms in order; stop if any extension consumes the input
    let transformed = input;
    for (const result of results) {
      if (result.consumed) {
        return { input: transformed, consumed: true };
      }
      if (result.input !== undefined) {
        transformed = result.input;
      }
    }
    if (transformed !== input) {
      return { input: transformed };
    }
  });

  pi.on('agent_end', async (...args: unknown[]) => {
    if (!runtime) return;
    const event = args[0] as { response?: string } | undefined;
    const response = event?.response ?? '';
    if (response) {
      await runtime.fire('agent_end', { response });
    }
  });

  pi.on('session_shutdown', async () => {
    if (runtime) {
      await runtime.shutdown();
      runtime = null;
    }
  });
}
