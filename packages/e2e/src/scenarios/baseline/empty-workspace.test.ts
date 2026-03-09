/**
 * Scenario: Empty workspace — no skills, no memory, no identity
 *
 * Validates the minimal guaranteed behavior of the runtime:
 * the system section is always present and the result shape is correct.
 *
 * STATUS: Baseline — should pass with current code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkspaceBuilder } from '../../workspace-builder.js';
import { runScenario } from '../../scenario-runner.js';
import type { BuiltWorkspace } from '../../workspace-builder.js';

describe('baseline / empty workspace', () => {
  let ws: BuiltWorkspace;

  beforeAll(async () => {
    ws = await WorkspaceBuilder.create().build();
  });

  afterAll(async () => ws.cleanup());

  describe('result shape', () => {
    it('sections is always an array', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: [] });
      expect(Array.isArray(result.sections)).toBe(true);
    });

    it('labels is always an array', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: [] });
      expect(Array.isArray(result.labels)).toBe(true);
    });

    it('formatted is always a string', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: [] });
      expect(typeof result.formatted).toBe('string');
    });
  });

  describe('system section', () => {
    it('is always present even with no extensions', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: [] });
      expect(result.sections).toHaveSection('dot-ai:system');
    });

    it('has priority 95', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: [] });
      expect(result.sections).toHaveSectionWithPriority('dot-ai:system', 95);
    });

    it('has source "core"', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: [] });
      expect(result.sections).toHaveSectionWithSource('dot-ai:system', 'core');
    });

    it('has trimStrategy "never" (never dropped on budget trim)', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: [] });
      const sys = result.systemSection;
      expect(sys?.trimStrategy).toBe('never');
    });

    it('content is non-empty', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: [] });
      expect(result.systemSection?.content.length).toBeGreaterThan(0);
    });
  });

  describe('no extension sections', () => {
    it('no skill sections without skill extension', async () => {
      const result = await runScenario(ws.dir, 'deploy the app', { extensions: [] });
      expect(result.skillSections).toHaveLength(0);
    });

    it('no memory sections without memory extension', async () => {
      const result = await runScenario(ws.dir, 'what do you remember', { extensions: [] });
      expect(result.memorySections).toHaveLength(0);
    });

    it('no identity sections without identity extension', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: [] });
      expect(result.identitySections).toHaveLength(0);
    });
  });

  describe('ordering', () => {
    it('sections are sorted by priority DESC', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: [] });
      expect(result.sections).toHaveSectionsOrderedByPriority();
    });
  });
});
