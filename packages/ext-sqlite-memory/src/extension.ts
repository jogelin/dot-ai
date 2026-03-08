import type { ExtensionAPI } from '@dot-ai/core';
import { SqliteMemoryProvider } from './sqlite-memory.js';

export default function(api: ExtensionAPI) {
  const provider = new SqliteMemoryProvider({ ...api.config, root: api.workspaceRoot });

  api.on('session_end', async () => {
    try {
      await provider.consolidate?.();
    } catch { /* ignore */ }
    try {
      provider.close();
    } catch { /* ignore */ }
  });

  api.on('context_enrich', async (event) => {
    const labelNames = event.labels.map(l => l.name);
    const memories = await provider.search(event.prompt, labelNames);

    const MAX_ENTRIES = 5;
    const MAX_ENTRY_CHARS = 200;
    const description = provider.describe();
    const content = memories.length > 0
      ? `> ${description}\n\n${memories.slice(0, MAX_ENTRIES).map(m => {
          const date = m.date ? ` (${m.date})` : '';
          const truncated = m.content.length > MAX_ENTRY_CHARS
            ? m.content.slice(0, MAX_ENTRY_CHARS) + '…'
            : m.content;
          return `- ${truncated}${date}`;
        }).join('\n')}`
      : `> ${description}\n\nNo relevant memories found for this prompt.`;

    return {
      sections: [{
        id: 'memory:recall',
        title: 'Memory',
        content,
        priority: 80,
        source: 'ext-sqlite-memory',
        trimStrategy: 'truncate' as const,
      }],
    };
  });

  api.on('agent_end', async (event) => {
    const response = event.response;
    if (!response || response.length < 100) return;
    if (response.includes('NO_REPLY') || response.includes('HEARTBEAT_OK')) return;
    const CONVERSATIONAL_PREFIXES = ['OK', 'Done', "Here's", "I've", 'Sure', 'No problem', 'Voilà', "C'est fait"];
    const trimmed = response.trimStart();
    if (CONVERSATIONAL_PREFIXES.some(prefix => trimmed.startsWith(prefix))) return;

    const MAX_LEARN_LENGTH = 500;
    const truncated = response.length > MAX_LEARN_LENGTH
      ? response.slice(0, MAX_LEARN_LENGTH) + '…'
      : response;

    try {
      await provider.store({
        content: truncated,
        type: 'log',
        date: new Date().toISOString().slice(0, 10),
      });
    } catch { /* ignore store errors */ }
  });

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
      await provider.store({ content: text, type, date: new Date().toISOString().slice(0, 10) });
      return { content: `Memory stored (type: ${type}).` };
    },
  });
}
