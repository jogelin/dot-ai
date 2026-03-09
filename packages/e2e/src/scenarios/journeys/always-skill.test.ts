/**
 * Journey: Project with always-on company rules.
 *
 * Some skills must be injected on every prompt regardless of relevance —
 * company policies, security rules, architectural constraints.
 * These use `triggers: [always]` and inject their full content.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkspaceBuilder } from '../../workspace-builder.js';
import { runScenario } from '../../scenario-runner.js';
import type { BuiltWorkspace } from '../../workspace-builder.js';

describe('journey: project with always-on company rules', () => {
  let ws: BuiltWorkspace;

  beforeAll(async () => {
    ws = await WorkspaceBuilder.create()
      .withSkill('company-rules', {
        description: 'Mandatory company coding standards and security policies',
        labels: [],
        triggers: ['always'],
        content: [
          '---',
          'description: Mandatory company coding standards and security policies',
          'triggers: [always]',
          '---',
          '# Company Rules',
          '',
          '- Never commit secrets to git',
          '- All PRs require 2 approvals',
          '- No direct pushes to main branch',
          '- Run security scan before every release',
        ].join('\n'),
      })
      .withSkill('deploy', {
        description: 'Deployment procedures',
        labels: ['deploy', 'production'],
        content: '# Deploy\n\nDeploy guide.',
      })
      .build();
  });

  afterAll(async () => ws.cleanup());

  it('"hello" → always-skill injected with full content', async () => {
    const result = await runScenario(ws.dir, 'hello', { extensions: ['skills'] });

    const rulesSection = result.getSection('skill:company-rules');
    expect(rulesSection).toBeDefined();
    expect(rulesSection?.detailLevel).toBe('full');
    expect(rulesSection?.content).toContain('Never commit secrets');
    expect(rulesSection?.content).toContain('No direct pushes');
  });

  it('"deploy to production" → both always-skill AND deploy directive injected', async () => {
    const result = await runScenario(
      ws.dir,
      'deploy the release to production',
      { extensions: ['skills'] },
    );

    const rulesSection = result.getSection('skill:company-rules');
    expect(rulesSection?.detailLevel).toBe('full');

    expect(result.sections).toHaveDirectiveForSkill('deploy');
  });

  it('"what is 2+2" → always-skill still injected (no exceptions)', async () => {
    const result = await runScenario(ws.dir, 'what is 2+2', { extensions: ['skills'] });

    const rulesSection = result.getSection('skill:company-rules');
    expect(rulesSection).toBeDefined();
    expect(rulesSection?.content).toContain('Company Rules');
  });

  it('always-skill full content survives token budget (never dropped)', async () => {
    const result = await runScenario(ws.dir, 'hello', { extensions: ['skills'] });
    const { formatSections } = await import('@dot-ai/core');

    // Even with a tight budget, always-skills use trimStrategy 'drop'
    // but the content is compact enough to fit
    const formatted = formatSections(result.sections, { tokenBudget: 500 });
    expect(formatted).toContain('Company Rules');
  });
});
