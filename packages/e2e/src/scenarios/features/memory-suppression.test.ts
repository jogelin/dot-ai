/**
 * Scenario: Memory suppression when no entries found
 *
 * TARGET behavior (not yet implemented):
 * — Empty memory store → NO memory section injected (zero noise)
 * — Memories exist but none match → NO section injected
 * — Memories match → section injected as today
 *
 * CURRENT behavior: always injects a section ("No relevant memories found")
 * See baseline/memory.test.ts for current behavior documentation.
 *
 * STATUS: FAILING — will pass once ext-file-memory returns early when empty.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkspaceBuilder } from '../../workspace-builder.js';
import { runScenario } from '../../scenario-runner.js';
import type { BuiltWorkspace } from '../../workspace-builder.js';

describe('feature / memory suppression', () => {

  describe('empty memory store', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create().build(); // no memories at all
    });

    afterAll(async () => ws.cleanup());

    it('no memory section when memory dir does not exist', async () => {
      const result = await runScenario(ws.dir, 'hello world', { extensions: ['memory'] });
      expect(result.memorySections).toHaveLength(0);
    });

    it('no memory section for any prompt when store is empty', async () => {
      const prompts = ['deploy the app', 'fix the bug', 'what is the architecture'];
      for (const prompt of prompts) {
        const result = await runScenario(ws.dir, prompt, { extensions: ['memory'] });
        expect(result.memorySections).toHaveLength(0);
      }
    });
  });

  describe('memories exist but none relevant', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create()
        .withMemory({ content: 'Fixed authentication bug in login flow', type: 'fact' })
        .build();
    });

    afterAll(async () => ws.cleanup());

    it('no memory section when prompt is completely unrelated', async () => {
      // "weather" has nothing to do with "authentication" memories
      const result = await runScenario(ws.dir, 'what is the weather like today', { extensions: ['memory'] });
      expect(result.memorySections).toHaveLength(0);
    });
  });

  describe('memories found', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create()
        .withMemory({ content: 'Fixed authentication bug in login flow', type: 'fact' })
        .build();
    });

    afterAll(async () => ws.cleanup());

    it('memory section is present when relevant memories found', async () => {
      const result = await runScenario(ws.dir, 'fix the authentication issue', { extensions: ['memory'] });
      expect(result.memorySections.length).toBeGreaterThan(0);
    });
  });
});
