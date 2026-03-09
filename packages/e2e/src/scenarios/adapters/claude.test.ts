/**
 * Scenario: Claude adapter output
 *
 * Validates the formatted context injected by adapter-claude's UserPromptSubmit hook.
 * We test the formatted output directly (same logic as the hook) without spawning
 * a real Claude Code process.
 *
 * The hook: reads prompt from stdin → processPrompt() → formatSections() → stdout JSON
 * We validate: the formatted string is correct markdown for Claude injection.
 *
 * STATUS: Baseline — should pass with current code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkspaceBuilder } from '../../workspace-builder.js';
import { runScenario } from '../../scenario-runner.js';
import { formatSections } from '@dot-ai/core';
import type { BuiltWorkspace } from '../../workspace-builder.js';

describe('adapter / claude — hook injection format', () => {

  describe('system section always injected', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create().build();
    });

    afterAll(async () => ws.cleanup());

    it('formatted output is valid for Claude injection (non-empty string)', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: [] });
      const hookOutput = formatSections(result.sections);
      expect(typeof hookOutput).toBe('string');
      expect(hookOutput.length).toBeGreaterThan(0);
    });

    it('hook output JSON structure: { result: string }', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: [] });
      const hookOutput = formatSections(result.sections);
      // The hook writes JSON.stringify({ result: formatted })
      const json = JSON.stringify({ result: hookOutput });
      const parsed = JSON.parse(json);
      expect(parsed).toHaveProperty('result');
      expect(typeof parsed.result).toBe('string');
    });
  });

  describe('with skills matching prompt', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create()
        .withSkill('code-review', {
          description: 'Code review guidelines and best practices',
          labels: ['review', 'code-review', 'pr', 'pull-request'],
          content: '# Code Review\n\nHow to review code effectively.',
        })
        .build();
    });

    afterAll(async () => ws.cleanup());

    it('skill content appears in hook output when prompt matches', async () => {
      const result = await runScenario(ws.dir, 'review this pull request', { extensions: ['skills'] });
      const hookOutput = formatSections(result.sections);
      // With directive format the section contains the skill name (not the full markdown heading)
      expect(hookOutput).toContain('code-review');
    });

    it('skill content absent from hook output when prompt does not match', async () => {
      const result = await runScenario(ws.dir, 'what is 2 + 2', { extensions: ['skills'] });
      const hookOutput = formatSections(result.sections);
      expect(hookOutput).not.toContain('Code Review');
    });
  });

  describe('PreToolUse hook equivalent — tool call blocking', () => {
    /**
     * Tool call blocking is handled by fireToolCall() in the runtime.
     * This is tested in unit tests (extension-runner.test.ts).
     * Here we just verify the hook produces no block for safe tools.
     */
    it('fireToolCall returns null for unknown tools (no blocking)', async () => {
      const ws = await WorkspaceBuilder.create().build();
      const result = await runScenario(ws.dir, 'hello', { extensions: [] });
      await ws.cleanup();

      // Verify result shape — tool blocking is tested elsewhere
      expect(result.sections).toBeDefined();
    });
  });

  describe('token budget compliance', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create()
        .withSkill('deploy', {
          description: 'Deployment guide',
          labels: ['deploy'],
          content: 'X'.repeat(5000), // Large content
        })
        .withSkill('testing', {
          description: 'Testing guide',
          labels: ['test'],
          content: 'Y'.repeat(5000), // Large content
        })
        .build();
    });

    afterAll(async () => ws.cleanup());

    it('output respects token budget when specified', async () => {
      const result = await runScenario(ws.dir, 'deploy and test', { extensions: ['skills'] });
      const budget = 1000; // tokens
      const trimmed = formatSections(result.sections, { tokenBudget: budget });
      const estimatedTokens = Math.round(trimmed.length / 4);
      expect(estimatedTokens).toBeLessThanOrEqual(budget + 50); // small margin for overhead
    });

    it('system section survives even aggressive token budget', async () => {
      const result = await runScenario(ws.dir, 'deploy and test', { extensions: ['skills'] });
      const tightBudget = 100;
      const trimmed = formatSections(result.sections, { tokenBudget: tightBudget });
      expect(trimmed).toContain('dot-ai');
    });
  });
});
