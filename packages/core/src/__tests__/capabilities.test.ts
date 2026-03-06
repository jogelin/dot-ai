import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildCapabilities, toolDefinitionToCapability } from '../capabilities.js';
import type { Providers } from '../engine.js';
import type { ToolDefinition } from '../extension-types.js';

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function makeMockMemory(overrides?: Partial<typeof mockMemoryBase>) {
  return { ...mockMemoryBase, ...overrides };
}

const mockMemoryBase = {
  search: vi.fn().mockResolvedValue([]),
  store: vi.fn().mockResolvedValue(undefined),
  describe: vi.fn().mockReturnValue('Test memory'),
};

function makeMockTasks(overrides?: Partial<typeof mockTasksBase>) {
  return { ...mockTasksBase, ...overrides };
}

const mockTasksBase = {
  list: vi.fn().mockResolvedValue([]),
  get: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockResolvedValue({ id: '1', text: 'Test', status: 'pending' }),
  update: vi.fn().mockResolvedValue({ id: '1', text: 'Test', status: 'done' }),
};

// ---------------------------------------------------------------------------
// buildCapabilities — memory provider
// ---------------------------------------------------------------------------

describe('buildCapabilities() with memory provider', () => {
  let memory: ReturnType<typeof makeMockMemory>;
  let providers: Providers;

  beforeEach(() => {
    memory = {
      search: vi.fn().mockResolvedValue([]),
      store: vi.fn().mockResolvedValue(undefined),
      describe: vi.fn().mockReturnValue('Test memory'),
    };
    providers = { memory };
  });

  // -- memory_recall --

  describe('memory_recall', () => {
    it('is present when memory provider is configured', () => {
      const caps = buildCapabilities(providers);
      expect(caps.find((c) => c.name === 'memory_recall')).toBeDefined();
    });

    it('executes a valid query and returns formatted results', async () => {
      memory.search = vi.fn().mockResolvedValue([
        { type: 'fact', content: 'TypeScript is typed JS' },
        { type: 'decision', content: 'Use vitest for tests' },
      ]);
      const caps = buildCapabilities({ memory });
      const cap = caps.find((c) => c.name === 'memory_recall')!;

      const result = await cap.execute({ query: 'typescript' });

      expect(memory.search).toHaveBeenCalledWith('typescript');
      expect(result.text).toContain('TypeScript is typed JS');
      expect(result.text).toContain('Use vitest for tests');
      expect(result.details).toEqual({ count: 2 });
    });

    it('returns error when query param is missing / not a string', async () => {
      const caps = buildCapabilities(providers);
      const cap = caps.find((c) => c.name === 'memory_recall')!;

      const result = await cap.execute({ query: 42 });

      expect(result.text).toMatch(/Error.*query/i);
      expect(result.details).toMatchObject({ error: true });
    });

    it('returns "no memories" message when results are empty', async () => {
      const caps = buildCapabilities(providers);
      const cap = caps.find((c) => c.name === 'memory_recall')!;

      const result = await cap.execute({ query: 'nothing here' });

      expect(result.text).toMatch(/No memories found/i);
      expect(result.details).toEqual({ count: 0 });
    });

    it('includes date in output when entry has a date', async () => {
      memory.search = vi.fn().mockResolvedValue([
        { type: 'log', content: 'Something happened', date: '2024-01-15' },
      ]);
      const caps = buildCapabilities({ memory });
      const cap = caps.find((c) => c.name === 'memory_recall')!;

      const result = await cap.execute({ query: 'something' });

      expect(result.text).toContain('2024-01-15');
    });

    it('omits date portion when entry has no date', async () => {
      memory.search = vi.fn().mockResolvedValue([
        { type: 'log', content: 'No date entry' },
      ]);
      const caps = buildCapabilities({ memory });
      const cap = caps.find((c) => c.name === 'memory_recall')!;

      const result = await cap.execute({ query: 'no date' });

      // Should not contain a trailing parenthetical date
      expect(result.text).not.toMatch(/\(\d{4}-\d{2}-\d{2}\)/);
    });

    it('respects limit parameter', async () => {
      memory.search = vi.fn().mockResolvedValue([
        { type: 'fact', content: 'Entry 1' },
        { type: 'fact', content: 'Entry 2' },
        { type: 'fact', content: 'Entry 3' },
      ]);
      const caps = buildCapabilities({ memory });
      const cap = caps.find((c) => c.name === 'memory_recall')!;

      const result = await cap.execute({ query: 'entries', limit: 2 });

      expect(result.details).toEqual({ count: 2 });
      expect(result.text).toContain('Entry 1');
      expect(result.text).toContain('Entry 2');
      expect(result.text).not.toContain('Entry 3');
    });

    it('has readOnly: true and category: memory', () => {
      const cap = buildCapabilities(providers).find((c) => c.name === 'memory_recall')!;
      expect(cap.readOnly).toBe(true);
      expect(cap.category).toBe('memory');
    });
  });

  // -- memory_store --

  describe('memory_store', () => {
    it('is present when memory provider is configured', () => {
      const caps = buildCapabilities(providers);
      expect(caps.find((c) => c.name === 'memory_store')).toBeDefined();
    });

    it('stores with valid text and calls provider.store', async () => {
      const caps = buildCapabilities(providers);
      const cap = caps.find((c) => c.name === 'memory_store')!;

      const result = await cap.execute({ text: 'Remember this fact' });

      expect(memory.store).toHaveBeenCalledOnce();
      const call = memory.store.mock.calls[0][0];
      expect(call.content).toBe('Remember this fact');
      expect(result.text).toContain('Memory stored');
    });

    it('defaults type to "log" when type param is omitted', async () => {
      const caps = buildCapabilities(providers);
      const cap = caps.find((c) => c.name === 'memory_store')!;

      await cap.execute({ text: 'Some log entry' });

      const call = memory.store.mock.calls[0][0];
      expect(call.type).toBe('log');
    });

    it('uses explicit type when provided', async () => {
      const caps = buildCapabilities(providers);
      const cap = caps.find((c) => c.name === 'memory_store')!;

      await cap.execute({ text: 'A decision', type: 'decision' });

      const call = memory.store.mock.calls[0][0];
      expect(call.type).toBe('decision');
    });

    it('returns error when text param is missing / not a string', async () => {
      const caps = buildCapabilities(providers);
      const cap = caps.find((c) => c.name === 'memory_store')!;

      const result = await cap.execute({ text: 123 });

      expect(result.text).toMatch(/Error.*text/i);
      expect(result.details).toMatchObject({ error: true });
      expect(memory.store).not.toHaveBeenCalled();
    });

    it('has readOnly: false and category: memory', () => {
      const cap = buildCapabilities(providers).find((c) => c.name === 'memory_store')!;
      expect(cap.readOnly).toBe(false);
      expect(cap.category).toBe('memory');
    });
  });
});

// ---------------------------------------------------------------------------
// buildCapabilities — tasks provider
// ---------------------------------------------------------------------------

describe('buildCapabilities() with tasks provider', () => {
  let tasks: ReturnType<typeof makeMockTasks>;
  let providers: Providers;

  beforeEach(() => {
    tasks = {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: '1', text: 'Test', status: 'pending' }),
      update: vi.fn().mockResolvedValue({ id: '1', text: 'Test', status: 'done' }),
    };
    providers = { tasks };
  });

  // -- task_list --

  describe('task_list', () => {
    it('is present when tasks provider is configured', () => {
      const caps = buildCapabilities(providers);
      expect(caps.find((c) => c.name === 'task_list')).toBeDefined();
    });

    it('calls list with no filter when no params provided', async () => {
      const caps = buildCapabilities(providers);
      const cap = caps.find((c) => c.name === 'task_list')!;

      await cap.execute({});

      expect(tasks.list).toHaveBeenCalledWith(undefined);
    });

    it('calls list with status filter when status param provided', async () => {
      const caps = buildCapabilities(providers);
      const cap = caps.find((c) => c.name === 'task_list')!;

      await cap.execute({ status: 'pending' });

      expect(tasks.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    });

    it('returns formatted task list when tasks exist', async () => {
      tasks.list = vi.fn().mockResolvedValue([
        { id: 'abc', text: 'Fix the bug', status: 'pending' },
        { id: 'def', text: 'Write tests', status: 'in_progress' },
      ]);
      const caps = buildCapabilities({ tasks });
      const cap = caps.find((c) => c.name === 'task_list')!;

      const result = await cap.execute({});

      expect(result.text).toContain('Fix the bug');
      expect(result.text).toContain('Write tests');
      expect(result.details).toEqual({ count: 2 });
    });

    it('returns "No tasks found" for empty results', async () => {
      const caps = buildCapabilities(providers);
      const cap = caps.find((c) => c.name === 'task_list')!;

      const result = await cap.execute({});

      expect(result.text).toMatch(/No tasks found/i);
      expect(result.details).toEqual({ count: 0 });
    });

    it('has readOnly: true and category: tasks', () => {
      const cap = buildCapabilities(providers).find((c) => c.name === 'task_list')!;
      expect(cap.readOnly).toBe(true);
      expect(cap.category).toBe('tasks');
    });
  });

  // -- task_create --

  describe('task_create', () => {
    it('is present when tasks provider is configured', () => {
      const caps = buildCapabilities(providers);
      expect(caps.find((c) => c.name === 'task_create')).toBeDefined();
    });

    it('creates task with valid text and returns result', async () => {
      const caps = buildCapabilities(providers);
      const cap = caps.find((c) => c.name === 'task_create')!;

      const result = await cap.execute({ text: 'New task' });

      expect(tasks.create).toHaveBeenCalledOnce();
      expect(result.text).toContain('Task created');
      expect(result.text).toContain('[1]');
      expect(result.details).toMatchObject({ id: '1' });
    });

    it('defaults status to "pending" when status param omitted', async () => {
      const caps = buildCapabilities(providers);
      const cap = caps.find((c) => c.name === 'task_create')!;

      await cap.execute({ text: 'Task without status' });

      const call = tasks.create.mock.calls[0][0];
      expect(call.status).toBe('pending');
    });

    it('returns error when text param is missing / not a string', async () => {
      const caps = buildCapabilities(providers);
      const cap = caps.find((c) => c.name === 'task_create')!;

      const result = await cap.execute({ text: null });

      expect(result.text).toMatch(/Error.*text/i);
      expect(result.details).toMatchObject({ error: true });
      expect(tasks.create).not.toHaveBeenCalled();
    });

    it('has readOnly: false and category: tasks', () => {
      const cap = buildCapabilities(providers).find((c) => c.name === 'task_create')!;
      expect(cap.readOnly).toBe(false);
      expect(cap.category).toBe('tasks');
    });
  });

  // -- task_update --

  describe('task_update', () => {
    it('is present when tasks provider is configured', () => {
      const caps = buildCapabilities(providers);
      expect(caps.find((c) => c.name === 'task_update')).toBeDefined();
    });

    it('updates task with valid id and returns result', async () => {
      const caps = buildCapabilities(providers);
      const cap = caps.find((c) => c.name === 'task_update')!;

      const result = await cap.execute({ id: '1', status: 'done' });

      expect(tasks.update).toHaveBeenCalledWith('1', expect.objectContaining({ status: 'done' }));
      expect(result.text).toContain('Task updated');
      expect(result.text).toContain('[1]');
      expect(result.details).toMatchObject({ id: '1' });
    });

    it('returns error when id param is missing / not a string', async () => {
      const caps = buildCapabilities(providers);
      const cap = caps.find((c) => c.name === 'task_update')!;

      const result = await cap.execute({ status: 'done' });

      expect(result.text).toMatch(/Error.*id/i);
      expect(result.details).toMatchObject({ error: true });
      expect(tasks.update).not.toHaveBeenCalled();
    });

    it('passes all optional patch fields through', async () => {
      const caps = buildCapabilities(providers);
      const cap = caps.find((c) => c.name === 'task_update')!;

      await cap.execute({ id: '42', status: 'done', text: 'Updated', priority: 'high', project: 'core', tags: ['bug'] });

      expect(tasks.update).toHaveBeenCalledWith(
        '42',
        expect.objectContaining({ status: 'done', text: 'Updated', priority: 'high', project: 'core', tags: ['bug'] }),
      );
    });

    it('has readOnly: false and category: tasks', () => {
      const cap = buildCapabilities(providers).find((c) => c.name === 'task_update')!;
      expect(cap.readOnly).toBe(false);
      expect(cap.category).toBe('tasks');
    });
  });
});

// ---------------------------------------------------------------------------
// buildCapabilities — partial providers
// ---------------------------------------------------------------------------

describe('buildCapabilities() with partial providers', () => {
  it('returns only memory caps when only memory is provided', () => {
    const memory = {
      search: vi.fn().mockResolvedValue([]),
      store: vi.fn().mockResolvedValue(undefined),
      describe: vi.fn().mockReturnValue('Test memory'),
    };
    const caps = buildCapabilities({ memory });
    const names = caps.map((c) => c.name);

    expect(names).toContain('memory_recall');
    expect(names).toContain('memory_store');
    expect(names).not.toContain('task_list');
    expect(names).not.toContain('task_create');
    expect(names).not.toContain('task_update');
  });

  it('returns only task caps when only tasks is provided', () => {
    const tasks = {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: '1', text: 'T', status: 'pending' }),
      update: vi.fn().mockResolvedValue({ id: '1', text: 'T', status: 'done' }),
    };
    const caps = buildCapabilities({ tasks });
    const names = caps.map((c) => c.name);

    expect(names).toContain('task_list');
    expect(names).toContain('task_create');
    expect(names).toContain('task_update');
    expect(names).not.toContain('memory_recall');
    expect(names).not.toContain('memory_store');
  });

  it('returns all caps when both memory and tasks are provided', () => {
    const memory = {
      search: vi.fn().mockResolvedValue([]),
      store: vi.fn().mockResolvedValue(undefined),
      describe: vi.fn().mockReturnValue('Test memory'),
    };
    const tasks = {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: '1', text: 'T', status: 'pending' }),
      update: vi.fn().mockResolvedValue({ id: '1', text: 'T', status: 'done' }),
    };
    const caps = buildCapabilities({ memory, tasks });
    const names = caps.map((c) => c.name);

    expect(names).toContain('memory_recall');
    expect(names).toContain('memory_store');
    expect(names).toContain('task_list');
    expect(names).toContain('task_create');
    expect(names).toContain('task_update');
  });

  it('returns empty caps when neither memory nor tasks is provided', () => {
    const caps = buildCapabilities({});
    expect(caps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// toolDefinitionToCapability
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// buildCapabilities — extensionTools
// ---------------------------------------------------------------------------

describe('buildCapabilities() with extensionTools', () => {
  function makeExtensionTool(name: string): ToolDefinition {
    return {
      name,
      description: `Extension tool ${name}`,
      parameters: { type: 'object', properties: {} },
      execute: vi.fn().mockResolvedValue({ content: `result from ${name}` }),
    };
  }

  it('adds extension tools as capabilities', () => {
    const tool = makeExtensionTool('ext_search');
    const caps = buildCapabilities({}, [tool]);
    const names = caps.map((c) => c.name);

    expect(names).toContain('ext_search');
  });

  it('extension tool capability executes and returns text', async () => {
    const tool = makeExtensionTool('ext_action');
    const caps = buildCapabilities({}, [tool]);
    const cap = caps.find((c) => c.name === 'ext_action')!;

    const result = await cap.execute({ param: 'value' });

    expect(result.text).toBe('result from ext_action');
  });

  it('merges extension tools alongside provider capabilities', () => {
    const memory = {
      search: vi.fn().mockResolvedValue([]),
      store: vi.fn().mockResolvedValue(undefined),
      describe: vi.fn().mockReturnValue('Test memory'),
    };
    const tool = makeExtensionTool('ext_extra');
    const caps = buildCapabilities({ memory }, [tool]);
    const names = caps.map((c) => c.name);

    expect(names).toContain('memory_recall');
    expect(names).toContain('memory_store');
    expect(names).toContain('ext_extra');
  });

  it('multiple extension tools are all added', () => {
    const tools = [makeExtensionTool('tool_a'), makeExtensionTool('tool_b'), makeExtensionTool('tool_c')];
    const caps = buildCapabilities({}, tools);
    const names = caps.map((c) => c.name);

    expect(names).toContain('tool_a');
    expect(names).toContain('tool_b');
    expect(names).toContain('tool_c');
    expect(caps).toHaveLength(3);
  });

  it('returns empty array when no providers and no extensionTools', () => {
    const caps = buildCapabilities({});
    expect(caps).toHaveLength(0);
  });
});
