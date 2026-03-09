/**
 * Journey: Project with an agent persona (AGENTS.md / SOUL.md).
 *
 * The identity file defines who the agent is for this project.
 * It must appear on every prompt, before everything else (highest priority).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkspaceBuilder } from '../../workspace-builder.js';
import { runScenario } from '../../scenario-runner.js';
import type { BuiltWorkspace } from '../../workspace-builder.js';

describe('journey: project with agent persona', () => {
  let ws: BuiltWorkspace;

  beforeAll(async () => {
    ws = await WorkspaceBuilder.create()
      .withIdentity('AGENTS.md', [
        '# Agent Instructions',
        '',
        'You are a senior backend engineer for Acme Corp.',
        'Always respond in English.',
        'Prefer TypeScript. Never use `any`.',
      ].join('\n'))
      .build();
  });

  afterAll(async () => ws.cleanup());

  it('greeting → identity + system, persona content visible', async () => {
    const result = await runScenario(ws.dir, 'hello', { extensions: ['identity'] });

    expect(result.identitySections.length).toBeGreaterThan(0);
    expect(result.systemSection).toBeDefined();

    const identityContent = result.identitySections.map(s => s.content).join('\n');
    expect(identityContent).toContain('senior backend engineer');
    expect(identityContent).toContain('Never use `any`');
  });

  it('identity is injected before system section (higher priority)', async () => {
    const result = await runScenario(ws.dir, 'hello', { extensions: ['identity'] });

    const identity = result.identitySections[0];
    const system = result.systemSection;

    expect(identity).toBeDefined();
    expect(system).toBeDefined();
    expect(identity!.priority).toBeGreaterThan(system!.priority); // 100 > 95
  });

  it('identity injected on every prompt, even unrelated ones', async () => {
    const prompts = ['hello', 'deploy the app', 'what is 2+2', 'fix the bug'];

    for (const prompt of prompts) {
      const result = await runScenario(ws.dir, prompt, { extensions: ['identity'] });
      expect(result.identitySections.length).toBeGreaterThan(0);
    }
  });

  it('identity appears first in formatted output', async () => {
    const result = await runScenario(ws.dir, 'hello', { extensions: ['identity'] });

    const identityPos = result.formatted.indexOf('senior backend engineer');
    const systemPos = result.formatted.indexOf('dot-ai');

    expect(identityPos).toBeGreaterThan(-1);
    expect(identityPos).toBeLessThan(systemPos); // identity before system
  });
});
