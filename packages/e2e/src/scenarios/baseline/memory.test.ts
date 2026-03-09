/**
 * Scenario: Memory injection
 *
 * Validates ext-file-memory behavior:
 * — memories found → section injected with content
 * — empty store → CURRENT behavior (always injects, even empty)
 *
 * NOTE: The "empty store → no section" test is in features/memory-suppression.test.ts
 * This file documents CURRENT behavior as a regression baseline.
 *
 * STATUS: Baseline — should pass with current code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkspaceBuilder } from '../../workspace-builder.js';
import { runScenario } from '../../scenario-runner.js';
import type { BuiltWorkspace } from '../../workspace-builder.js';

describe('baseline / memory injection', () => {

  describe('with matching memories', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create()
        .withMemory({ content: 'Fixed the authentication bug in the login flow', type: 'fact' })
        .withMemory({ content: 'Deployed new version to staging on Friday', type: 'log' })
        .withMemory({ content: 'Decided to use SQLite for session storage', type: 'decision' })
        .build();
    });

    afterAll(async () => ws.cleanup());

    it('memory section is injected', async () => {
      const result = await runScenario(ws.dir, 'what happened with authentication', { extensions: ['memory'] });
      expect(result.memorySections.length).toBeGreaterThan(0);
    });

    it('memory section has priority 80', async () => {
      const result = await runScenario(ws.dir, 'authentication', { extensions: ['memory'] });
      const mem = result.memorySections[0];
      expect(mem?.priority).toBe(80);
    });

    it('memory section source is "ext-file-memory"', async () => {
      const result = await runScenario(ws.dir, 'authentication', { extensions: ['memory'] });
      const mem = result.memorySections[0];
      expect(mem?.source).toBe('ext-file-memory');
    });

    it('memory content contains the relevant entry', async () => {
      const result = await runScenario(ws.dir, 'authentication bug', { extensions: ['memory'] });
      const mem = result.memorySections[0];
      expect(mem?.content).toContain('authentication');
    });

    it('memory section appears below system section in sorted output', async () => {
      const result = await runScenario(ws.dir, 'authentication', { extensions: ['memory'] });
      const sys = result.sections.findIndex(s => s.id === 'dot-ai:system');
      const memIdx = result.sections.findIndex(s => s.source === 'ext-file-memory');
      expect(sys).toBeLessThan(memIdx); // system (95) before memory (80)
    });
  });

  describe('with empty memory store', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      // No memories — just a bare workspace
      ws = await WorkspaceBuilder.create().build();
    });

    afterAll(async () => ws.cleanup());

    /**
     * New behavior (after memory-suppression feature):
     * no section when store is empty — zero noise.
     * See features/memory-suppression.test.ts for the full suppression test suite.
     */
    it('no memory section when store is empty', async () => {
      const result = await runScenario(ws.dir, 'hello world', { extensions: ['memory'] });
      expect(result.memorySections).toHaveLength(0);
    });
  });

  describe('combined with skills', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create()
        .withMemory({ content: 'Last deployment used blue-green strategy', type: 'decision' })
        .withSkill('deploy', {
          description: 'Deployment procedures for production releases',
          labels: ['deploy', 'production'],
          content: '# Deploy\n\nProduction deployment guide.',
        })
        .build();
    });

    afterAll(async () => ws.cleanup());

    it('both skill and memory sections injected for matching prompt', async () => {
      const result = await runScenario(
        ws.dir,
        'deploy to production',
        { extensions: ['skills', 'memory'] },
      );
      expect(result.sections).toHaveSkillSection('deploy');
      expect(result.memorySections.length).toBeGreaterThan(0);
    });

    it('memory (80) comes after system (95) but before skill (60)', async () => {
      const result = await runScenario(
        ws.dir,
        'deploy to production',
        { extensions: ['skills', 'memory'] },
      );
      expect(result.sections).toHaveSectionsOrderedByPriority();
    });
  });
});
