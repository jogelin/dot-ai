/**
 * Scenario: Skill matching — workspace with multiple skills
 *
 * Validates that the skill scoring pipeline correctly matches skills
 * to prompts and injects them as sections.
 *
 * STATUS: Baseline — should pass with current code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkspaceBuilder } from '../../workspace-builder.js';
import { runScenario } from '../../scenario-runner.js';
import type { BuiltWorkspace } from '../../workspace-builder.js';

describe('baseline / skill matching', () => {
  let ws: BuiltWorkspace;

  beforeAll(async () => {
    ws = await WorkspaceBuilder.create()
      .withSkill('deploy', {
        description: 'Production deployment procedures, release management, rollback strategies',
        labels: ['deploy', 'release', 'production', 'rollback'],
        content: '# Deploy\n\nStep-by-step production deployment guide.',
      })
      .withSkill('testing', {
        description: 'Testing strategies: unit tests, integration tests, e2e tests',
        labels: ['test', 'testing', 'unit', 'integration', 'e2e'],
        content: '# Testing\n\nWriting tests guide.',
      })
      .withSkill('security', {
        description: 'Security audits, vulnerability scanning, dependency checks',
        labels: ['security', 'vulnerability', 'audit', 'cve'],
        content: '# Security\n\nSecurity procedures guide.',
      })
      .build();
  });

  afterAll(async () => ws.cleanup());

  describe('correct skill is matched', () => {
    it('matches deploy skill on deployment prompt', async () => {
      const result = await runScenario(ws.dir, 'I need to deploy the app to production', { extensions: ['skills'] });
      expect(result.sections).toHaveSkillSection('deploy');
    });

    it('matches testing skill on test-related prompt', async () => {
      // Two label hits (unit + integration) → score ≥ 2.5 → injected
      const result = await runScenario(ws.dir, 'write unit and integration tests for this module', { extensions: ['skills'] });
      expect(result.sections).toHaveSkillSection('testing');
    });

    it('matches security skill on security prompt', async () => {
      const result = await runScenario(ws.dir, 'run a security audit on the dependencies', { extensions: ['skills'] });
      expect(result.sections).toHaveSkillSection('security');
    });
  });

  describe('no false positives', () => {
    it('does not inject skills for unrelated prompt', async () => {
      const result = await runScenario(ws.dir, 'what is the capital of France', { extensions: ['skills'] });
      expect(result.skillSections).toHaveLength(0);
    });

    it('does not inject all skills when only one matches', async () => {
      const result = await runScenario(ws.dir, 'deploy the release to production', { extensions: ['skills'] });
      // deploy should match, testing and security should not
      expect(result.sections).toHaveSkillSection('deploy');
      expect(result.sections).not.toHaveSkillSection('testing');
      expect(result.sections).not.toHaveSkillSection('security');
    });
  });

  describe('section properties', () => {
    it('skill section id is "skill:{name}"', async () => {
      const result = await runScenario(ws.dir, 'deploy to production', { extensions: ['skills'] });
      expect(result.hasSection('skill:deploy')).toBe(true);
    });

    it('skill section source is "ext-file-skills"', async () => {
      const result = await runScenario(ws.dir, 'deploy to production', { extensions: ['skills'] });
      expect(result.sections).toHaveSectionWithSource('skill:deploy', 'ext-file-skills');
    });

    it('skill section priority is 60', async () => {
      const result = await runScenario(ws.dir, 'deploy to production', { extensions: ['skills'] });
      expect(result.sections).toHaveSectionWithPriority('skill:deploy', 60);
    });

    it('skill section content includes the skill markdown', async () => {
      const result = await runScenario(ws.dir, 'deploy to production', { extensions: ['skills'] });
      expect(result.sections).toHaveSectionContent('skill:deploy', /deploy/i);
    });
  });

  describe('system section catalog', () => {
    it('system section lists registered skill names', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: ['skills'] });
      const content = result.systemSection?.content ?? '';
      // At least one of our skills should appear in the catalog
      const hasAny = ['deploy', 'testing', 'security'].some(name => content.includes(name));
      expect(hasAny).toBe(true);
    });
  });

  describe('ordering', () => {
    it('sections are sorted by priority DESC with skills below system', async () => {
      const result = await runScenario(ws.dir, 'deploy to production', { extensions: ['skills'] });
      const sys = result.sections.findIndex(s => s.id === 'dot-ai:system');
      const skill = result.sections.findIndex(s => s.id === 'skill:deploy');
      expect(sys).toBeLessThan(skill); // system (95) before skill (60)
    });
  });
});
