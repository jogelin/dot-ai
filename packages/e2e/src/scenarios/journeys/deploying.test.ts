/**
 * Journey: Developer deploying to production.
 *
 * A project with a deploy skill and past deployment memories.
 * Shows exactly what the agent sees at each step of a deploy workflow.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkspaceBuilder } from '../../workspace-builder.js';
import { runScenario } from '../../scenario-runner.js';
import type { BuiltWorkspace } from '../../workspace-builder.js';

describe('journey: developer deploying to production', () => {
  let ws: BuiltWorkspace;

  beforeAll(async () => {
    ws = await WorkspaceBuilder.create()
      .withSkill('deploy-production', {
        description: 'Production deployment using blue-green strategy with rollback',
        labels: ['deploy', 'production', 'release', 'rollback', 'blue-green'],
        content: [
          '---',
          'description: Production deployment using blue-green strategy with rollback',
          'labels: [deploy, production, release, rollback, blue-green]',
          '---',
          '# Deploy to Production',
          '',
          '1. Run test suite',
          '2. Create blue-green deployment',
          '3. Smoke test new environment',
          '4. Switch traffic',
          '5. Monitor for 15 minutes',
          '6. Rollback procedure if needed',
        ].join('\n'),
      })
      .withMemory({ content: 'Last production deploy: used blue-green, took 12 minutes, no issues', type: 'log' })
      .withMemory({ content: 'Deploy checklist: always run integration tests before switching traffic', type: 'decision' })
      .withMemory({ content: 'Rollback happened on 2024-11-15 due to DB migration failure', type: 'fact' })
      .build();
  });

  afterAll(async () => ws.cleanup());

  it('"hello" → system only, no deploy context injected', async () => {
    const result = await runScenario(ws.dir, 'hello', { extensions: ['skills', 'memory'] });

    expect(result.skillSections).toHaveLength(0);
    expect(result.memorySections).toHaveLength(0);
    expect(result.systemSection).toBeDefined();
  });

  it('"deploy to production" → deploy skill injected as directive', async () => {
    const result = await runScenario(
      ws.dir,
      'I need to deploy the new release to production with rollback capability',
      { extensions: ['skills', 'memory'] },
    );

    expect(result.sections).toHaveDirectiveForSkill('deploy-production');

    const section = result.getSection('skill:deploy-production');
    expect(section?.content).toMatch(/→ Use skill:/);
    expect(section?.content).toContain('deploy-production');
    // Directive is compact — not the full SKILL.md
    expect(section?.content.length).toBeLessThan(200);
  });

  it('"deploy to production" → past deploy memories also injected', async () => {
    const result = await runScenario(
      ws.dir,
      'deploy to production',
      { extensions: ['skills', 'memory'] },
    );

    expect(result.memorySections.length).toBeGreaterThan(0);
    const memContent = result.memorySections.map(s => s.content).join('\n');
    expect(memContent).toMatch(/deploy|blue-green|checklist/i);
  });

  it('"deploy to production" → system > memory > skill order', async () => {
    const result = await runScenario(
      ws.dir,
      'deploy to production',
      { extensions: ['skills', 'memory'] },
    );

    expect(result.sections).toHaveSectionsOrderedByPriority();

    const systemPos = result.formatted.indexOf('dot-ai');
    const skillPos = result.formatted.indexOf('Use skill:');

    expect(systemPos).toBeLessThan(skillPos);
  });

  it('agent can load full skill content on demand via load_skill tool', async () => {
    const result = await runScenario(ws.dir, 'hello', { extensions: ['skills'] });

    // load_skill tool should be registered
    const toolOutput = await result.executeTool('load_skill', { name: 'deploy-production' });
    expect(toolOutput.content).toContain('Deploy to Production');
    expect(toolOutput.content).toContain('blue-green');
    expect(toolOutput.isError).toBeFalsy();
  });

  it('load_skill returns error for unknown skill name', async () => {
    const result = await runScenario(ws.dir, 'hello', { extensions: ['skills'] });

    const toolOutput = await result.executeTool('load_skill', { name: 'nonexistent-skill' });
    expect(toolOutput.isError).toBe(true);
    expect(toolOutput.content).toContain('not found');
  });
});
