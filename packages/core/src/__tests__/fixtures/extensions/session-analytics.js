/** Session analytics extension — tracks tool usage stats */
export default function(api) {
  const stats = { toolCalls: 0, toolsUsed: new Map() };

  api.on('tool_call', async (event) => {
    stats.toolCalls++;
    stats.toolsUsed.set(event.tool, (stats.toolsUsed.get(event.tool) ?? 0) + 1);
  });

  api.on('agent_end', async () => {
    // In a real extension, this would log to a file or API
    // For testing, we just track the stats
  });

  // Register a tool to query analytics
  api.registerTool({
    name: 'session_stats',
    description: 'Get session analytics (tool call counts)',
    parameters: { type: 'object', properties: {}, required: [] },
    async execute() {
      const topTools = Array.from(stats.toolsUsed.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `${name}: ${count}`)
        .join(', ');
      return { content: `Total calls: ${stats.toolCalls}. Tools: ${topTools || 'none'}` };
    },
  });
}
