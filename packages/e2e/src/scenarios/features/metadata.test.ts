/**
 * Scenario: Extension metadata → architecture section
 *
 * TARGET behavior (not yet implemented):
 * — Extensions call api.contributeMetadata() at boot
 * — core assembles a compact "Workspace Context" table in the system section
 * — Agent can answer "what memory backend are you using?" from the system section alone
 * — No empty "No relevant memories found" noise
 *
 * STATUS: FAILING — will pass once contributeMetadata() is implemented in core
 * and extensions (ext-file-memory, ext-file-skills) call it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkspaceBuilder } from '../../workspace-builder.js';
import { runScenario } from '../../scenario-runner.js';
import type { BuiltWorkspace } from '../../workspace-builder.js';

describe('feature / extension metadata → architecture section', () => {

  describe('memory extension metadata', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create()
        .withMemory('Some memory entry to confirm memory is active')
        .build();
    });

    afterAll(async () => ws.cleanup());

    it('system section contains memory backend info', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: ['memory'] });
      // After feature: system section should mention "Memory" and "File" (File-based backend)
      expect(result.sections).toHaveArchitectureEntry('memory');
    });

    it('system section mentions available memory tools', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: ['memory'] });
      const content = result.systemSection?.content ?? '';
      expect(content).toMatch(/memory_recall|memory_store/i);
    });
  });

  describe('skills extension metadata', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create()
        .withSkill('deploy', {
          description: 'Deployment skill',
          labels: ['deploy'],
          content: '# Deploy',
        })
        .withSkill('testing', {
          description: 'Testing skill',
          labels: ['test'],
          content: '# Test',
        })
        .build();
    });

    afterAll(async () => ws.cleanup());

    it('system section contains skills count', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: ['skills'] });
      // After feature: system section should say "Skills: 2 registered" or similar
      expect(result.sections).toHaveArchitectureEntry('skills');
      const content = result.systemSection?.content ?? '';
      expect(content).toMatch(/2/); // 2 skills registered
    });
  });

  describe('multiple extensions metadata combined', () => {
    let ws: BuiltWorkspace;

    beforeAll(async () => {
      ws = await WorkspaceBuilder.create()
        .withMemory('Some memory')
        .withSkill('deploy', {
          description: 'Deployment skill',
          labels: ['deploy'],
          content: '# Deploy',
        })
        .build();
    });

    afterAll(async () => ws.cleanup());

    it('system section contains entries for all loaded extensions', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: ['skills', 'memory'] });
      expect(result.sections).toHaveArchitectureEntry('memory');
      expect(result.sections).toHaveArchitectureEntry('skills');
    });

    it('single system section (not one per extension)', async () => {
      const result = await runScenario(ws.dir, 'hello', { extensions: ['skills', 'memory'] });
      const systemSections = result.sections.filter(s => s.id === 'dot-ai:system');
      expect(systemSections).toHaveLength(1);
    });
  });
});
