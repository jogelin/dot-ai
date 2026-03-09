/**
 * Scenario: Pi adapter output
 *
 * Validates that the formatted output produced by the core pipeline
 * is correct for injection as a Pi systemPrompt.
 *
 * Pi receives a `systemPrompt` string from `before_agent_start`.
 * We test the formatted output directly (same as what adapter-pi produces)
 * without spawning a real Pi process.
 *
 * STATUS: Baseline — should pass with current code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkspaceBuilder } from '../../workspace-builder.js';
import { runScenario } from '../../scenario-runner.js';
import { formatSections } from '@dot-ai/core';
import type { BuiltWorkspace } from '../../workspace-builder.js';

describe('adapter / pi — systemPrompt format', () => {

  describe('minimal workspace', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create().build();
    });

    afterAll(async () => ws.cleanup());

    it('formatted output is a non-empty string', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: [] });
      expect(result.formatted).toBeTruthy();
      expect(typeof result.formatted).toBe('string');
    });

    it('formatted output contains dot-ai system section', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: [] });
      expect(result.formatted).toContain('dot-ai');
    });

    it('formatted output uses markdown heading format (## Title)', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: [] });
      expect(result.formatted).toMatch(/^## /m);
    });

    it('sections are separated by ---', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: ['memory'] });
      // When more than one section exists, they are separated by ---
      if (result.sections.length > 1) {
        expect(result.formatted).toContain('---');
      }
    });
  });

  describe('with skills', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create()
        .withSkill('deploy', {
          description: 'Production deployment procedures',
          labels: ['deploy', 'release'],
          content: '# Deploy\n\nStep-by-step deployment guide.',
        })
        .build();
    });

    afterAll(async () => ws.cleanup());

    it('matched skill appears in formatted output', async () => {
      const result = await runScenario(ws.dir, 'deploy the app to production', { extensions: ['skills'] });
      // With directive format, the section uses the skill name (lowercase) not the markdown heading
      expect(result.formatted).toContain('deploy');
    });

    it('system section comes before skill section in output', async () => {
      const result = await runScenario(ws.dir, 'deploy the release', { extensions: ['skills'] });
      const sysIdx = result.formatted.indexOf('dot-ai');
      const skillIdx = result.formatted.indexOf('Skill:');
      if (skillIdx !== -1) {
        expect(sysIdx).toBeLessThan(skillIdx);
      }
    });
  });

  describe('with identity', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create()
        .withIdentity('AGENTS.md', '# AGENTS\n\nYou are a professional software engineer.')
        .build();
    });

    afterAll(async () => ws.cleanup());

    it('identity content appears in formatted output', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: ['identity'] });
      expect(result.formatted).toContain('software engineer');
    });

    it('identity section has higher priority than system section', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: ['identity'] });
      const identitySections = result.identitySections;
      if (identitySections.length > 0) {
        expect(identitySections[0].priority).toBeGreaterThan(95); // identity (100) > system (95)
      }
    });
  });

  describe('priority ordering in output', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create()
        .withMemory('Authentication was fixed last week')
        .withSkill('deploy', {
          description: 'Deployment procedures',
          labels: ['deploy'],
          content: '# Deploy\n\nDeployment guide.',
        })
        .build();
    });

    afterAll(async () => ws.cleanup());

    it('sections appear in priority order: system > memory > skill', async () => {
      const result = await runScenario(
        ws.dir,
        'deploy the app',
        { extensions: ['skills', 'memory'] },
      );

      expect(result.sections).toHaveSectionsOrderedByPriority();

      const formatted = result.formatted;
      const sysPos = formatted.indexOf('dot-ai');
      const skillPos = formatted.indexOf('Skill:');

      if (skillPos !== -1) {
        expect(sysPos).toBeLessThan(skillPos);
      }
    });
  });

  describe('snapshot: formatted output structure', () => {
    it('formatted output matches snapshot for consistent structure', async () => {
      const ws = await WorkspaceBuilder.create()
        .withSkill('deploy', {
          description: 'Deployment procedures',
          labels: ['deploy'],
          content: '# Deploy\n\nDeploy to production.',
        })
        .build();

      const result = await runScenario(ws.dir, 'deploy the app', { extensions: ['skills'] });
      await ws.cleanup();

      // Snapshot the section structure (ids + priorities + sources, not content)
      // This catches structural regressions without being brittle about content changes
      const structure = result.sections.map(s => ({
        id: s.id,
        priority: s.priority,
        source: s.source,
        trimStrategy: s.trimStrategy,
      }));

      expect(structure).toMatchSnapshot();
    });
  });
});
