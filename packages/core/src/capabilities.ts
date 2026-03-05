import type { Providers } from './engine.js';

/**
 * The result returned by a capability execution.
 */
export interface CapabilityResult {
  text: string;
  details?: Record<string, unknown>;
}

/**
 * An interactive tool (capability) that a provider exposes to agents.
 * Adapters translate these into the agent's native tool format.
 */
export interface Capability {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute(params: Record<string, unknown>): Promise<CapabilityResult>;
  /** Capability category */
  category?: 'memory' | 'tasks' | string;
  /** Whether this capability only reads data (no side effects) */
  readOnly?: boolean;
  /** Whether the adapter should ask for user confirmation before executing */
  confirmationRequired?: boolean;
  /** Capability version — incremented when parameter schema changes */
  version?: number;
}

/**
 * Build the list of capabilities from active providers.
 * Always generates capabilities for memory and tasks — execution handles empty results gracefully.
 */
export function buildCapabilities(providers: Providers): Capability[] {
  const caps: Capability[] = [];

  // --- Memory capabilities ---

  caps.push({
    name: 'memory_recall',
    description: `Search stored memories. ${providers.memory.describe()}`,
    category: 'memory',
    readOnly: true,
    version: 1,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query to find relevant memories.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return. Defaults to 10.',
        },
      },
      required: ['query'],
    },
    async execute(params: Record<string, unknown>): Promise<CapabilityResult> {
      const query = params['query'];
      if (typeof query !== 'string') {
        return { text: 'Error: "query" parameter must be a string.', details: { error: true } };
      }
      const limit = typeof params['limit'] === 'number' ? params['limit'] : 10;

      const entries = await providers.memory.search(query);
      const results = entries.slice(0, limit);

      if (results.length === 0) {
        return { text: 'No memories found for this query.', details: { count: 0 } };
      }

      const lines = results.map(
        (e, i) => `${i + 1}. [${e.type}] ${e.content}${e.date ? ` (${e.date})` : ''}`,
      );

      return {
        text: lines.join('\n'),
        details: { count: results.length },
      };
    },
  });

  caps.push({
    name: 'memory_store',
    description: 'Store a new entry in memory for future recall.',
    category: 'memory',
    readOnly: false,
    version: 1,
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Content to store in memory.',
        },
        type: {
          type: 'string',
          description: 'Memory type: fact, decision, lesson, log, pattern. Defaults to log.',
        },
      },
      required: ['text'],
    },
    async execute(params: Record<string, unknown>): Promise<CapabilityResult> {
      const text = params['text'];
      if (typeof text !== 'string') {
        return { text: 'Error: "text" parameter must be a string.', details: { error: true } };
      }
      const type = typeof params['type'] === 'string' ? params['type'] : 'log';

      await providers.memory.store({
        content: text,
        type,
        date: new Date().toISOString().slice(0, 10),
      });

      return { text: `Memory stored (type: ${type}).` };
    },
  });

  // --- Task capabilities ---

  caps.push({
    name: 'task_list',
    description: 'List tasks, optionally filtered by status, project, or tags.',
    category: 'tasks',
    readOnly: true,
    version: 1,
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by status (e.g. pending, in_progress, done).',
        },
        project: {
          type: 'string',
          description: 'Filter by project name.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags (all provided tags must match).',
        },
      },
      required: [],
    },
    async execute(params: Record<string, unknown>): Promise<CapabilityResult> {
      const filter: Record<string, unknown> = {};
      if (typeof params['status'] === 'string') filter['status'] = params['status'];
      if (typeof params['project'] === 'string') filter['project'] = params['project'];
      if (Array.isArray(params['tags'])) filter['tags'] = params['tags'];

      const tasks = await providers.tasks.list(
        Object.keys(filter).length > 0 ? filter as Parameters<typeof providers.tasks.list>[0] : undefined,
      );

      if (tasks.length === 0) {
        return { text: 'No tasks found.', details: { count: 0 } };
      }

      const lines = tasks.map((t, i) => {
        const meta = [t.status, t.project, t.tags?.join(', ')].filter(Boolean).join(' | ');
        return `${i + 1}. [${t.id}] ${t.text}${meta ? ` (${meta})` : ''}`;
      });

      return {
        text: lines.join('\n'),
        details: { count: tasks.length },
      };
    },
  });

  caps.push({
    name: 'task_create',
    description: 'Create a new task.',
    category: 'tasks',
    readOnly: false,
    version: 1,
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Task description.',
        },
        status: {
          type: 'string',
          description: 'Initial status. Defaults to pending.',
        },
        priority: {
          type: 'string',
          description: 'Priority level (e.g. low, medium, high).',
        },
        project: {
          type: 'string',
          description: 'Project this task belongs to.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to attach to the task.',
        },
      },
      required: ['text'],
    },
    async execute(params: Record<string, unknown>): Promise<CapabilityResult> {
      const text = params['text'];
      if (typeof text !== 'string') {
        return { text: 'Error: "text" parameter must be a string.', details: { error: true } };
      }
      const status = typeof params['status'] === 'string' ? params['status'] : 'pending';

      const taskData: Parameters<typeof providers.tasks.create>[0] = { text, status };
      if (typeof params['priority'] === 'string') taskData.priority = params['priority'];
      if (typeof params['project'] === 'string') taskData.project = params['project'];
      if (Array.isArray(params['tags'])) taskData.tags = params['tags'] as string[];

      const task = await providers.tasks.create(taskData);

      return {
        text: `Task created: [${task.id}] ${task.text}`,
        details: { id: task.id },
      };
    },
  });

  caps.push({
    name: 'task_update',
    description: 'Update an existing task by ID.',
    category: 'tasks',
    readOnly: false,
    version: 1,
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Task ID to update.',
        },
        status: {
          type: 'string',
          description: 'New status.',
        },
        text: {
          type: 'string',
          description: 'Updated task description.',
        },
        priority: {
          type: 'string',
          description: 'Updated priority.',
        },
        project: {
          type: 'string',
          description: 'Updated project.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated tags (replaces existing).',
        },
      },
      required: ['id'],
    },
    async execute(params: Record<string, unknown>): Promise<CapabilityResult> {
      const id = params['id'];
      if (typeof id !== 'string') {
        return { text: 'Error: "id" parameter must be a string.', details: { error: true } };
      }
      const patch: Parameters<typeof providers.tasks.update>[1] = {};

      if (typeof params['status'] === 'string') patch.status = params['status'];
      if (typeof params['text'] === 'string') patch.text = params['text'];
      if (typeof params['priority'] === 'string') patch.priority = params['priority'];
      if (typeof params['project'] === 'string') patch.project = params['project'];
      if (Array.isArray(params['tags'])) patch.tags = params['tags'] as string[];

      const task = await providers.tasks.update(id, patch);

      return {
        text: `Task updated: [${task.id}] ${task.text} (status: ${task.status})`,
        details: { id: task.id },
      };
    },
  });

  // Check for custom capabilities from providers
  for (const provider of Object.values(providers)) {
    if (provider && typeof (provider as Record<string, unknown>)['capabilities'] === 'function') {
      try {
        const custom = (provider as { capabilities(): Capability[] }).capabilities();
        caps.push(...custom);
      } catch {
        // Skip if custom capabilities fail
      }
    }
  }

  return caps;
}
