import type { ExtensionAPI } from '@dot-ai/core';
import { FilePromptProvider } from './file-prompts.js';

export default function(api: ExtensionAPI) {
  const provider = new FilePromptProvider({ ...api.config, root: api.workspaceRoot });

  api.on('resources_discover', async () => {
    const prompts = await provider.list();
    return {
      labels: prompts.map(p => p.name),
      resources: prompts.map(p => ({
        type: 'prompt' as const,
        path: p.name,
        labels: [p.name],
        metadata: { description: p.description, args: p.args },
      })),
    };
  });

  provider.list().then(prompts => {
    for (const prompt of prompts) {
      api.registerCommand({
        name: prompt.name,
        description: prompt.description ?? `Run ${prompt.name} prompt template`,
        parameters: (prompt.args ?? []).map(arg => ({
          name: arg,
          description: `Value for ${arg}`,
          required: true,
        })),
        async execute(args) {
          const content = await provider.load(prompt.name);
          if (!content) return { output: `Template ${prompt.name} not found.` };
          let result = content;
          for (const [key, value] of Object.entries(args)) {
            result = result.replace(new RegExp(`\\$${key}\\b`, 'g'), value);
          }
          return { output: result };
        },
      });
    }
  }).catch(() => { /* ignore errors during eager load */ });
}
