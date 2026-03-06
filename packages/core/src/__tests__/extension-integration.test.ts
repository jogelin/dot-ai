import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { loadExtensions } from '../extension-loader.js';
import { ExtensionRunner } from '../extension-runner.js';

const fixtureDir = join(import.meta.dirname, 'fixtures', 'extensions');

describe('Extension Integration', () => {
  it('loads sample extensions and runs full lifecycle', async () => {
    const paths = [
      join(fixtureDir, 'security-gate.js'),
      join(fixtureDir, 'smart-context.js'),
      join(fixtureDir, 'session-analytics.js'),
    ];

    const extensions = await loadExtensions(paths);
    expect(extensions).toHaveLength(3);

    const runner = new ExtensionRunner(extensions);

    // Test security gate blocks .env writes
    const blocked = await runner.fireUntilBlocked('tool_call', {
      tool: 'Write',
      input: { file_path: '/project/.env' },
    });
    expect(blocked?.decision).toBe('block');

    // Test security gate allows normal writes
    const allowed = await runner.fireUntilBlocked('tool_call', {
      tool: 'Write',
      input: { file_path: '/project/src/app.ts' },
    });
    expect(allowed).toBeNull();

    // Test rm -rf / blocked
    const rmBlocked = await runner.fireUntilBlocked('tool_call', {
      tool: 'Bash',
      input: { command: 'rm -rf /' },
    });
    expect(rmBlocked?.decision).toBe('block');

    // Test smart context injection
    const injectResults = await runner.fire('context_inject', {
      prompt: 'fix memory',
      labels: [{ name: 'memory', source: 'test' }],
    });
    expect(injectResults).toContainEqual(
      expect.objectContaining({ inject: expect.stringContaining('memory') }),
    );

    // Test analytics tracks tool calls
    await runner.fire('tool_call', { tool: 'Read', input: {} });
    await runner.fire('tool_call', { tool: 'Read', input: {} });
    await runner.fire('tool_call', { tool: 'Write', input: {} });

    // Test session_stats tool exists
    const statsTool = runner.tools.find(t => t.name === 'session_stats');
    expect(statsTool).toBeDefined();

    // Execute the stats tool
    const statsResult = await statsTool!.execute({});
    expect(statsResult.content).toContain('Total calls:');
  });

  it('handles extension errors gracefully', async () => {
    const extensions = await loadExtensions([
      join(fixtureDir, 'security-gate.js'),
    ]);
    const runner = new ExtensionRunner(extensions);

    // Diagnostics should show the extension
    expect(runner.diagnostics).toHaveLength(1);
    expect(runner.diagnostics[0].toolNames).toEqual([]);
    expect(runner.usedTiers.has('universal')).toBe(true);
  });
});
