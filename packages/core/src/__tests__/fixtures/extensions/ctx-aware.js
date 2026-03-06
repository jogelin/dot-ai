/** Extension that uses ctx to access providers and workspace at event time */
export default function(api) {
  api.on('tool_call', async (event, ctx) => {
    // Use ctx.providers to check memory before allowing writes
    if (event.tool === 'Write' && ctx?.providers?.memory) {
      const memories = await ctx.providers.memory.search('blocked-files');
      if (memories.some(m => m.content.includes(event.input.file_path))) {
        return { decision: 'block', reason: `Blocked by memory policy: ${event.input.file_path}` };
      }
    }
  });

  api.on('context_inject', async (event, ctx) => {
    // Use ctx.workspaceRoot in injected context
    if (ctx?.workspaceRoot) {
      return { inject: `Workspace: ${ctx.workspaceRoot}` };
    }
  });

  api.on('session_start', async (_event, ctx) => {
    // Use ctx.events to announce session start
    if (ctx?.events) {
      ctx.events.emit('extension:ctx-aware:started', { workspace: ctx.workspaceRoot });
    }
  });
}
