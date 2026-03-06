/** Smart context extension — injects extra context via context_inject */
export default function(api) {
  api.on('context_inject', async (event) => {
    // Simple keyword-based context injection
    const keywords = event.labels?.map(l => l.name) ?? [];
    if (keywords.includes('memory')) {
      return { inject: '> Note: This workspace uses dot-ai memory system. Use memory_recall/memory_store tools.' };
    }
  });
}
