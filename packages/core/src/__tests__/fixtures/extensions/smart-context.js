/** Smart context extension — enriches context via context_enrich */
export default function(api) {
  api.on('context_enrich', async (event) => {
    // Simple keyword-based context injection
    const keywords = event.labels?.map(l => l.name) ?? [];
    if (keywords.includes('memory')) {
      return {
        sections: [{
          id: 'smart-context:memory',
          title: 'Memory',
          content: '> Note: This workspace uses dot-ai memory system. Use memory_recall/memory_store tools.',
          priority: 50,
          source: 'smart-context',
          trimStrategy: 'drop',
        }],
      };
    }
  });
}
