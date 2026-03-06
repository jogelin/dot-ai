import { describe, it, expect, vi } from 'vitest';
import { toolDefinitionToCapability } from '../capabilities.js';
import type { ToolDefinition } from '../extension-types.js';

describe('toolDefinitionToCapability()', () => {
  function makeToolDef(overrides?: Partial<ToolDefinition>): ToolDefinition {
    return {
      name: 'my_tool',
      description: 'Does something useful',
      parameters: { type: 'object', properties: { input: { type: 'string' } } },
      execute: vi.fn().mockResolvedValue({ content: 'result text', details: { extra: 42 } }),
      promptSnippet: 'Use my_tool for useful things.',
      promptGuidelines: 'Always provide input.',
      ...overrides,
    };
  }

  it('maps ToolDefinition fields to Capability correctly', () => {
    const tool = makeToolDef();
    const cap = toolDefinitionToCapability(tool);

    expect(cap.name).toBe('my_tool');
    expect(cap.description).toBe('Does something useful');
    expect(cap.parameters).toEqual(tool.parameters);
  });

  it('maps content → text in execute result', async () => {
    const tool = makeToolDef();
    const cap = toolDefinitionToCapability(tool);

    const result = await cap.execute({ input: 'hello' });

    expect(result.text).toBe('result text');
  });

  it('preserves details from the tool execute result', async () => {
    const tool = makeToolDef();
    const cap = toolDefinitionToCapability(tool);

    const result = await cap.execute({});

    expect(result.details).toEqual({ extra: 42 });
  });

  it('preserves promptSnippet', () => {
    const cap = toolDefinitionToCapability(makeToolDef());
    expect(cap.promptSnippet).toBe('Use my_tool for useful things.');
  });

  it('preserves promptGuidelines', () => {
    const cap = toolDefinitionToCapability(makeToolDef());
    expect(cap.promptGuidelines).toBe('Always provide input.');
  });

  it('handles missing promptSnippet / promptGuidelines gracefully', () => {
    const tool = makeToolDef({ promptSnippet: undefined, promptGuidelines: undefined });
    const cap = toolDefinitionToCapability(tool);

    expect(cap.promptSnippet).toBeUndefined();
    expect(cap.promptGuidelines).toBeUndefined();
  });

  it('forwards params to the underlying tool execute', async () => {
    const executeFn = vi.fn().mockResolvedValue({ content: 'ok' });
    const tool = makeToolDef({ execute: executeFn });
    const cap = toolDefinitionToCapability(tool);

    await cap.execute({ input: 'test-value' });

    expect(executeFn).toHaveBeenCalledWith({ input: 'test-value' });
  });
});
