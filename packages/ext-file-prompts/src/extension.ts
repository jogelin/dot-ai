import type { ExtensionAPI } from '@dot-ai/core';
import { FilePromptProvider } from './file-prompts.js';

export default async function(api: ExtensionAPI): Promise<void> {
  const provider = new FilePromptProvider({ ...api.config, root: api.workspaceRoot });

  // Eagerly discover prompts and contribute labels at boot
  const prompts = await provider.list();
  api.contributeLabels(prompts.map(p => p.name));

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
}
