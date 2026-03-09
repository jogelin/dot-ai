import type { ExtensionAPI } from '@dot-ai/core';
import { FileMemoryProvider } from './file-memory.js';

export default function(api: ExtensionAPI) {
  const provider = new FileMemoryProvider({ ...api.config, root: api.workspaceRoot });

  // Tell the core what we are so the system section can describe our backend
  api.contributeMetadata({
    category: 'memory',
    backend: 'File-based',
    tools: ['memory_recall', 'memory_store'],
  });

  api.on('context_enrich', async (event) => {
    const labelNames = event.labels.map(l => l.name);
    const memories = await provider.search(event.prompt, labelNames);

    // Suppress section entirely when no memories found — zero noise policy.
    // An empty "No relevant memories found" message wastes tokens and trains
    // the agent to ignore the section. If the agent needs to recall something,
    // it can call the memory_recall tool directly.
    if (memories.length === 0) return;

    const MAX_ENTRIES = 5;
    const MAX_ENTRY_CHARS = 200;
    const description = provider.describe();
    const content = `> ${description}\n\n${memories.slice(0, MAX_ENTRIES).map(m => {
      const date = m.date ? ` (${m.date})` : '';
      const truncated = m.content.length > MAX_ENTRY_CHARS
        ? m.content.slice(0, MAX_ENTRY_CHARS) + '…'
        : m.content;
      return `- ${truncated}${date}`;
    }).join('\n')}`;

    return {
      sections: [{
        id: 'memory:recall',
        title: 'Memory',
        content,
        priority: 80,
        source: 'ext-file-memory',
        trimStrategy: 'truncate' as const,
      }],
    };
  });

  // Auto-learning disabled — produces too much noise.
  // Memory should be managed explicitly via memory_store tool.

  api.registerTool({
    name: 'memory_recall',
    description: `Search stored memories. ${provider.describe()}`,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to find relevant memories.' },
        limit: { type: 'number', description: 'Maximum results. Defaults to 10.' },
      },
      required: ['query'],
    },
    async execute(input) {
      const query = input['query'];
      if (typeof query !== 'string') return { content: 'Error: "query" must be a string.', isError: true };
      const limit = typeof input['limit'] === 'number' ? input['limit'] : 10;
      const entries = await provider.search(query);
      const results = entries.slice(0, limit);
      if (results.length === 0) return { content: 'No memories found.' };
      const lines = results.map((e, i) => `${i + 1}. [${e.type}] ${e.content}${e.date ? ` (${e.date})` : ''}`);
      return { content: lines.join('\n'), details: { count: results.length } };
    },
  });

  api.registerTool({
    name: 'memory_store',
    description: 'Store a new entry in memory for future recall.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Content to store.' },
        type: { type: 'string', description: 'Memory type: fact, decision, lesson, log, pattern. Defaults to log.' },
      },
      required: ['text'],
    },
    async execute(input) {
      const text = input['text'];
      if (typeof text !== 'string') return { content: 'Error: "text" must be a string.', isError: true };
      const type = typeof input['type'] === 'string' ? input['type'] : 'log';
      try {
        await provider.store({ content: text, type, date: new Date().toISOString().slice(0, 10) });
      } catch (err) {
        return { content: `Error storing memory: ${err instanceof Error ? err.message : String(err)}`, isError: true };
      }
      return { content: `Memory stored (type: ${type}).` };
    },
  });
}
