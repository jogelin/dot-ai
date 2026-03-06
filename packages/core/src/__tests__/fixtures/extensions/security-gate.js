/** Security gate extension — blocks writes to sensitive files */
export default function(api) {
  api.on('tool_call', async (event) => {
    const sensitivePatterns = [/\.env$/i, /\.key$/i, /\.pem$/i];

    if (event.tool === 'Write' || event.tool === 'Edit') {
      const filePath = event.input.file_path ?? event.input.path ?? '';
      if (typeof filePath === 'string' && sensitivePatterns.some(p => p.test(filePath))) {
        return { decision: 'block', reason: `Blocked: writing to sensitive file ${filePath}` };
      }
    }

    if (event.tool === 'Bash') {
      const cmd = event.input.command ?? '';
      if (typeof cmd === 'string' && /rm\s+-rf\s+\//.test(cmd)) {
        return { decision: 'block', reason: 'Blocked: dangerous rm -rf / command' };
      }
    }
  });
}
