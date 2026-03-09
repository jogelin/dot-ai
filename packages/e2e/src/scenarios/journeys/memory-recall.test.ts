/**
 * Journey: Project accumulating knowledge over time.
 *
 * The memory system stores facts, decisions, and logs from past sessions.
 * When a prompt is relevant, past context is surfaced automatically.
 * When a prompt is unrelated, nothing is injected — no noise.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkspaceBuilder } from '../../workspace-builder.js';
import { runScenario } from '../../scenario-runner.js';
import type { BuiltWorkspace } from '../../workspace-builder.js';

describe('journey: project with accumulated memories', () => {
  let ws: BuiltWorkspace;

  beforeAll(async () => {
    ws = await WorkspaceBuilder.create()
      .withMemory({ content: 'Authentication uses JWT tokens, refresh token stored in httpOnly cookie', type: 'fact' })
      .withMemory({ content: 'Decided to use Postgres database over MySQL for JSONB support (2024-10-01)', type: 'decision' })
      .withMemory({ content: 'Fixed auth bug: missing token expiry check in middleware (2024-11-05)', type: 'log' })
      .withMemory({ content: 'Production deploy checklist: run migrations, restart workers, monitor logs', type: 'fact' })
      .withMemory({ content: 'Redis used for session cache, TTL set to 24 hours', type: 'fact' })
      .build();
  });

  afterAll(async () => ws.cleanup());

  it('"hello" → no memory injected (generic greeting, nothing to recall)', async () => {
    const result = await runScenario(ws.dir, 'hello', { extensions: ['memory'] });

    expect(result.memorySections).toHaveLength(0);
  });

  it('"fix the authentication issue" → auth memories surfaced', async () => {
    const result = await runScenario(ws.dir, 'fix the authentication issue', { extensions: ['memory'] });

    expect(result.memorySections.length).toBeGreaterThan(0);
    const content = result.memorySections.map(s => s.content).join('\n');
    expect(content).toMatch(/JWT|auth|token/i);
  });

  it('"what database are we using?" → database decision recalled', async () => {
    const result = await runScenario(ws.dir, 'what database are we using?', { extensions: ['memory'] });

    expect(result.memorySections.length).toBeGreaterThan(0);
    const content = result.memorySections.map(s => s.content).join('\n');
    expect(content).toMatch(/Postgres|MySQL|database/i);
  });

  it('"deploy to production" → deploy checklist recalled', async () => {
    const result = await runScenario(ws.dir, 'deploy to production', { extensions: ['memory'] });

    expect(result.memorySections.length).toBeGreaterThan(0);
    const content = result.memorySections.map(s => s.content).join('\n');
    expect(content).toMatch(/deploy|migration|checklist/i);
  });

  it('"what is the capital of France?" → no memory injected (completely unrelated)', async () => {
    const result = await runScenario(ws.dir, 'what is the capital of France?', { extensions: ['memory'] });

    expect(result.memorySections).toHaveLength(0);
  });

  it('agent can recall memories explicitly via memory_recall tool', async () => {
    const result = await runScenario(ws.dir, 'hello', { extensions: ['memory'] });

    const toolOutput = await result.executeTool('memory_recall', { query: 'authentication' });
    expect(toolOutput.isError).toBeFalsy();
    expect(toolOutput.content).toMatch(/JWT|auth|token/i);
  });

  it('agent can store new memories via memory_store tool', async () => {
    const result = await runScenario(ws.dir, 'hello', { extensions: ['memory'] });

    const storeOutput = await result.executeTool('memory_store', {
      text: 'Switched from REST to GraphQL for the public API',
      type: 'decision',
    });
    expect(storeOutput.isError).toBeFalsy();
    expect(storeOutput.content).toContain('stored');
  });
});
