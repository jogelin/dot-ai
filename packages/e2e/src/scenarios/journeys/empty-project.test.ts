/**
 * Journey: Empty project — brand new workspace, nothing configured.
 *
 * What an agent sees when dot-ai is installed but no .ai/ content exists yet.
 * The system section must always be present — it's the agent's minimum context.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkspaceBuilder } from '../../workspace-builder.js';
import { runScenario } from '../../scenario-runner.js';
import type { BuiltWorkspace } from '../../workspace-builder.js';

describe('journey: empty project', () => {
  let ws: BuiltWorkspace;

  beforeAll(async () => {
    ws = await WorkspaceBuilder.create().build();
  });

  afterAll(async () => ws.cleanup());

  it('greeting → only system section, no noise', async () => {
    const result = await runScenario(ws.dir, 'hello', { extensions: ['skills', 'memory', 'identity'] });

    expect(result.systemSection).toBeDefined();
    expect(result.skillSections).toHaveLength(0);
    expect(result.memorySections).toHaveLength(0);
    expect(result.identitySections).toHaveLength(0);
    expect(result.sections).toHaveLength(1); // system only
  });

  it('any technical prompt → still only system section (nothing to match)', async () => {
    const prompts = [
      'deploy the app to production',
      'fix the authentication bug',
      'run the test suite',
      'review this pull request',
    ];

    for (const prompt of prompts) {
      const result = await runScenario(ws.dir, prompt, { extensions: ['skills', 'memory'] });
      expect(result.skillSections).toHaveLength(0);
      expect(result.memorySections).toHaveLength(0);
    }
  });

  it('system section always describes what dot-ai is managing', async () => {
    const result = await runScenario(ws.dir, 'hello', { extensions: [] });
    const content = result.systemSection?.content ?? '';
    expect(content).toContain('dot-ai');
    expect(content).toContain('.ai/');
  });
});
