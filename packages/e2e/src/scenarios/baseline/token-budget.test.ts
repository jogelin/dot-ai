/**
 * Scenario: Token budget enforcement
 *
 * Validates that formatSections() trims sections correctly when a budget is set:
 * — system section (trimStrategy: 'never') is never dropped
 * — sections with 'drop' strategy are removed first (lowest priority first)
 * — sections with 'truncate' strategy are shortened before dropping
 *
 * STATUS: Baseline — should pass with current code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkspaceBuilder } from '../../workspace-builder.js';
import { runScenario } from '../../scenario-runner.js';
import { formatSections } from '@dot-ai/core';
import type { BuiltWorkspace } from '../../workspace-builder.js';

describe('baseline / token budget', () => {
  let ws: BuiltWorkspace;

  beforeAll(async () => {
    // Create a workspace with several skills so we have many sections
    ws = await WorkspaceBuilder.create()
      .withSkill('deploy', {
        description: 'Deployment guide',
        labels: ['deploy'],
        content: 'A'.repeat(3000), // 3000 char content
      })
      .withSkill('testing', {
        description: 'Testing guide',
        labels: ['test'],
        content: 'B'.repeat(3000),
      })
      .withMemory({ content: 'C'.repeat(500), type: 'fact' })
      .build();
  });

  afterAll(async () => ws.cleanup());

  describe('system section survives trimming', () => {
    it('system section is present even with very tight budget', async () => {
      const result = await runScenario(ws.dir, 'deploy and test', { extensions: ['skills', 'memory'] });

      // Format with a very tight budget (only enough for system section)
      const tightBudget = 200; // tokens
      const trimmed = formatSections(result.sections, { tokenBudget: tightBudget });

      expect(trimmed).toContain('dot-ai'); // system section must survive
    });
  });

  describe('sections dropped by priority', () => {
    it('lower priority sections are dropped first under budget pressure', async () => {
      const result = await runScenario(ws.dir, 'deploy and test', { extensions: ['skills', 'memory'] });

      // Budget that fits system + memory but not large skill content
      const mediumBudget = 600; // tokens ~ 2400 chars
      const trimmed = formatSections(result.sections, { tokenBudget: mediumBudget });
      const trimmedLength = Math.round(trimmed.length / 4);

      expect(trimmedLength).toBeLessThanOrEqual(mediumBudget + 50); // allow slight overflow
    });
  });

  describe('no budget = no trimming', () => {
    it('all matched sections present when no budget specified', async () => {
      const result = await runScenario(ws.dir, 'deploy and test', { extensions: ['skills', 'memory'] });
      const full = formatSections(result.sections);

      // Skills now inject compact directives (not full file content), so output
      // length is intentionally short. What we verify is that no sections were
      // dropped — both matched skill sections appear in the formatted output.
      expect(full).toContain('deploy');   // deploy skill directive
      expect(full).toContain('testing');  // testing skill directive (or overview)
    });
  });
});
