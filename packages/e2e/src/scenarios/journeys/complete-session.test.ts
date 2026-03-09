/**
 * Journey: Complete developer session — multiple prompts, realistic project.
 *
 * Simulates a full session as an agent would experience it:
 * boot → greeting → coding question → deployment → security review
 *
 * This is the closest test to "what does the agent actually see?"
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkspaceBuilder } from '../../workspace-builder.js';
import { runScenario } from '../../scenario-runner.js';
import type { BuiltWorkspace } from '../../workspace-builder.js';

describe('journey: complete developer session', () => {
  let ws: BuiltWorkspace;

  beforeAll(async () => {
    ws = await WorkspaceBuilder.create()
      // Identity
      .withIdentity('AGENTS.md', [
        '# Agent Instructions',
        'You are a senior fullstack engineer. Prefer TypeScript. Write tests.',
      ].join('\n'))
      // Skills
      .withSkill('deploy-production', {
        description: 'Production deployment with blue-green strategy and rollback',
        labels: ['deploy', 'production', 'release', 'rollback', 'blue-green'],
        content: '# Deploy\n\nFull deployment guide.',
      })
      .withSkill('security-review', {
        description: 'Security audit, vulnerability scanning, OWASP checklist',
        labels: ['security', 'audit', 'vulnerability', 'owasp'],
        content: '# Security Review\n\nSecurity checklist.',
      })
      .withSkill('testing-strategy', {
        description: 'Unit tests, integration tests, e2e testing with coverage',
        labels: ['test', 'testing', 'unit', 'integration', 'coverage'],
        content: '# Testing\n\nTesting guide.',
      })
      // Memories
      .withMemory({ content: 'Last deploy: blue-green to prod, 0 downtime (2024-12-01)', type: 'log' })
      .withMemory({ content: 'Authentication uses JWT tokens, refresh token stored in httpOnly cookie', type: 'fact' })
      .withMemory({ content: 'Security scan found XSS in user input — fixed in PR #234', type: 'log' })
      .build();
  });

  afterAll(async () => ws.cleanup());

  it('turn 1: "hello" → identity + system only, no noise', async () => {
    const result = await runScenario(ws.dir, 'hello', { extensions: ['identity', 'skills', 'memory'] });

    expect(result.identitySections.length).toBeGreaterThan(0);
    expect(result.systemSection).toBeDefined();
    expect(result.skillSections).toHaveLength(0);
    expect(result.memorySections).toHaveLength(0);

    // Agent sees who it is, but no irrelevant context
    expect(result.formatted).toContain('senior fullstack engineer');
  });

  it('turn 2: "write unit tests for the auth module" → testing skill + auth memories', async () => {
    const result = await runScenario(
      ws.dir,
      'write unit and integration tests for the authentication module',
      { extensions: ['identity', 'skills', 'memory'] },
    );

    // Testing skill injected
    expect(result.sections).toHaveSkillSection('testing-strategy');
    // Auth memories surfaced (auth is in memory + prompt)
    expect(result.memorySections.length).toBeGreaterThan(0);
    const memContent = result.memorySections.map(s => s.content).join('\n');
    expect(memContent).toMatch(/JWT|auth/i);
    // Deploy and security skills NOT injected (not relevant)
    expect(result.sections).not.toHaveSkillSection('deploy-production');
    expect(result.sections).not.toHaveSkillSection('security-review');
  });

  it('turn 3: "deploy the release to production with rollback" → deploy directive + deploy memories', async () => {
    const result = await runScenario(
      ws.dir,
      'deploy the release to production with rollback capability',
      { extensions: ['identity', 'skills', 'memory'] },
    );

    // Deploy skill as directive (high confidence)
    expect(result.sections).toHaveDirectiveForSkill('deploy-production');
    const deploySection = result.getSection('skill:deploy-production');
    expect(deploySection?.content).toMatch(/→ Use skill:/);

    // Past deploy memory surfaced
    expect(result.memorySections.length).toBeGreaterThan(0);
    const memContent = result.memorySections.map(s => s.content).join('\n');
    expect(memContent).toMatch(/blue-green|deploy/i);

    // Testing and security NOT injected
    expect(result.sections).not.toHaveSkillSection('testing-strategy');
    expect(result.sections).not.toHaveSkillSection('security-review');
  });

  it('turn 4: "security audit on the codebase" → security skill + security memories', async () => {
    const result = await runScenario(
      ws.dir,
      'run a full security audit and vulnerability scan on the codebase',
      { extensions: ['identity', 'skills', 'memory'] },
    );

    expect(result.sections).toHaveSkillSection('security-review');

    // XSS fix memory is relevant to security
    const memContent = result.memorySections.map(s => s.content).join('\n');
    expect(memContent).toMatch(/XSS|security|vulnerab/i);

    // Deploy skill NOT injected (prompt has no deploy/production/release/rollback signal)
    expect(result.sections).not.toHaveSkillSection('deploy-production');
  });

  it('every turn: identity and system are always present', async () => {
    const turns = [
      'hello',
      'write unit and integration tests',
      'deploy to production with rollback',
      'security audit before release',
    ];

    for (const prompt of turns) {
      const result = await runScenario(ws.dir, prompt, { extensions: ['identity', 'skills', 'memory'] });
      expect(result.systemSection).toBeDefined();
      expect(result.identitySections.length).toBeGreaterThan(0);
    }
  });

  it('every turn: sections are always in priority order (identity > system > memory > skill)', async () => {
    const turns = [
      'hello',
      'deploy to production with rollback',
    ];

    for (const prompt of turns) {
      const result = await runScenario(ws.dir, prompt, { extensions: ['identity', 'skills', 'memory'] });
      expect(result.sections).toHaveSectionsOrderedByPriority();
    }
  });
});
