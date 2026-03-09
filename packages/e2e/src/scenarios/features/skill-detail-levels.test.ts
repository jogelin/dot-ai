/**
 * Scenario: Score-based skill detail levels
 *
 * TARGET behavior (not yet implemented):
 * — High score (≥ 4.0): detailLevel = 'directive' — enforces skill usage
 *   Content: "→ Use skill: {name} — {description}"
 * — Medium score (1.5–3.9): detailLevel = 'overview' — suggests skill
 *   Content: "{name}: {description}" (no full file content)
 * — Low score (< 1.5): not injected at all
 *
 * The goal: guide the agent directly in the prompt without injecting full file content.
 * Full content is available natively (via sync) or on demand.
 *
 * STATUS: FAILING — will pass once ext-file-skills implements score-based detailLevel.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkspaceBuilder } from '../../workspace-builder.js';
import { runScenario } from '../../scenario-runner.js';
import type { BuiltWorkspace } from '../../workspace-builder.js';

describe('feature / skill detail levels', () => {
  let ws: BuiltWorkspace;

  beforeAll(async () => {
    ws = await WorkspaceBuilder.create()
      // Strong match: name + multiple labels all relevant to test prompt
      .withSkill('deploy-production', {
        description: 'Production deployment using blue-green strategy with rollback',
        labels: ['deploy', 'production', 'release', 'blue-green', 'rollback'],
        content: '# Production Deploy\n\nFull guide here (should NOT appear in directive/overview).',
      })
      // Weak match: only one label relevant
      .withSkill('git-workflow', {
        description: 'Standard git branching and commit workflow',
        labels: ['git', 'branch', 'commit', 'merge'],
        content: '# Git Workflow\n\nFull guide here (should NOT appear in overview).',
      })
      // No match: completely unrelated
      .withSkill('database-migrations', {
        description: 'Database schema migration procedures',
        labels: ['database', 'migration', 'schema', 'sql'],
        content: '# DB Migrations\n\nFull guide here.',
      })
      .build();
  });

  afterAll(async () => ws.cleanup());

  describe('directive level (score ≥ 6.0)', () => {
    it('high-scoring skill gets detailLevel = "directive"', async () => {
      // Prompt hits multiple labels: deploy, production, blue-green, rollback
      const result = await runScenario(
        ws.dir,
        'deploy to production using blue-green strategy with rollback capability',
        { extensions: ['skills'] },
      );
      expect(result.sections).toHaveDirectiveForSkill('deploy-production');
    });

    it('directive content guides agent to use the skill', async () => {
      const result = await runScenario(
        ws.dir,
        'deploy to production with rollback plan',
        { extensions: ['skills'] },
      );
      const section = result.getSection('skill:deploy-production');
      // Should contain an actionable directive, NOT the full markdown file content
      expect(section?.content).toMatch(/→|Use skill|use skill/i);
      expect(section?.content).not.toContain('Full guide here'); // no raw file content
    });

    it('directive is short (not the full skill file)', async () => {
      const result = await runScenario(
        ws.dir,
        'deploy to production with rollback plan',
        { extensions: ['skills'] },
      );
      const section = result.getSection('skill:deploy-production');
      // Directive should be a one-liner or very short, not a full file
      expect((section?.content.length ?? 0)).toBeLessThan(300);
    });
  });

  describe('overview level (2.5 ≤ score < 6.0)', () => {
    it('medium-scoring match gets detailLevel = "overview"', async () => {
      // Prompt hits "git" label (+2) and name-part "workflow" (+3) → score ~5 → overview
      // (below DIRECTIVE_THRESHOLD 6.0, above MIN_SCORE 2.5)
      const result = await runScenario(
        ws.dir,
        'what is the branch strategy for git',
        { extensions: ['skills'] },
      );
      expect(result.sections).toHaveOverviewForSkill('git-workflow');
    });

    it('overview content shows name and description only', async () => {
      const result = await runScenario(
        ws.dir,
        'what is the branch strategy for git',
        { extensions: ['skills'] },
      );
      const section = result.getSection('skill:git-workflow');
      // Should mention the skill and its description
      expect(section?.content).toContain('git-workflow');
      // Should NOT include the full markdown content
      expect(section?.content).not.toContain('Full guide here');
    });
  });

  describe('no injection (score < 2.5)', () => {
    it('completely unrelated skill is not injected', async () => {
      // Prompt about git — database-migrations should not match
      const result = await runScenario(
        ws.dir,
        'git push the changes',
        { extensions: ['skills'] },
      );
      expect(result.sections).not.toHaveSkillSection('database-migrations');
    });

    it('no skill sections for completely unrelated prompt', async () => {
      const result = await runScenario(
        ws.dir,
        'what is the capital of France',
        { extensions: ['skills'] },
      );
      expect(result.skillSections).toHaveLength(0);
    });
  });

  describe('label boost from label_extract pipeline', () => {
    it('skills whose labels are confirmed by label_extract get higher score', async () => {
      // Both deploy-production and git-workflow might partially match "deploy git push"
      // but deploy-production should win because its labels are more present
      const result = await runScenario(
        ws.dir,
        'deploy the release using git',
        { extensions: ['skills'] },
      );
      // deploy-production should be matched (deploy label confirmed)
      expect(result.sections).toHaveSkillSection('deploy-production');
    });
  });
});
