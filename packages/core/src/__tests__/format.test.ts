import { describe, it, expect } from 'vitest';
import { formatContext } from '../format.js';
import type { EnrichedContext, Identity, MemoryEntry, Skill, Tool } from '../types.js';

function makeContext(overrides?: Partial<EnrichedContext>): EnrichedContext {
  return {
    prompt: 'test prompt',
    labels: [],
    identities: [],
    memories: [],
    skills: [],
    tools: [],
    routing: { model: 'default', reason: '' },
    ...overrides,
  };
}

function makeIdentity(overrides?: Partial<Identity>): Identity {
  return {
    type: 'agents',
    content: 'You are Kiwi.',
    source: 'file',
    priority: 10,
    ...overrides,
  };
}

function makeMemory(overrides?: Partial<MemoryEntry>): MemoryEntry {
  return {
    content: 'User prefers TypeScript',
    type: 'fact',
    source: 'file',
    ...overrides,
  };
}

function makeSkill(overrides?: Partial<Skill>): Skill {
  return {
    name: 'my-skill',
    description: 'A skill',
    labels: [],
    content: 'Skill content here.',
    ...overrides,
  };
}

function makeTool(overrides?: Partial<Tool>): Tool {
  return {
    name: 'bash',
    description: 'Run shell commands',
    labels: [],
    config: {},
    source: 'file',
    ...overrides,
  };
}

describe('formatContext', () => {
  it('includes all sections when identities, memories, skills, and tools are present', () => {
    const ctx = makeContext({
      identities: [makeIdentity({ content: 'You are Kiwi.' })],
      memories: [makeMemory({ content: 'User prefers TypeScript' })],
      skills: [makeSkill({ name: 'dot-ai', content: 'dot-ai skill content' })],
      tools: [makeTool({ name: 'bash', description: 'Run shell commands' })],
    });

    const result = formatContext(ctx);

    expect(result).toContain('You are Kiwi.');
    expect(result).toContain('## Relevant Memory');
    expect(result).toContain('User prefers TypeScript');
    expect(result).toContain('## Active Skills');
    expect(result).toContain('dot-ai skill content');
    expect(result).toContain('## Available Tools');
    expect(result).toContain('bash');
  });

  it('skips identities when skipIdentities: true', () => {
    const ctx = makeContext({
      identities: [makeIdentity({ content: 'You are Kiwi.' })],
      memories: [makeMemory({ content: 'Some memory' })],
    });

    const result = formatContext(ctx, { skipIdentities: true });

    expect(result).not.toContain('You are Kiwi.');
    expect(result).toContain('## Relevant Memory');
  });

  it('includes identities when skipIdentities: false', () => {
    const ctx = makeContext({
      identities: [makeIdentity({ content: 'You are Kiwi.' })],
    });

    const result = formatContext(ctx, { skipIdentities: false });

    expect(result).toContain('You are Kiwi.');
  });

  it('includes identities when skipIdentities is undefined (backward compat)', () => {
    const ctx = makeContext({
      identities: [makeIdentity({ content: 'You are Kiwi.' })],
    });

    const result = formatContext(ctx);

    expect(result).toContain('You are Kiwi.');
  });

  it('sorts identities by priority descending', () => {
    const ctx = makeContext({
      identities: [
        makeIdentity({ content: 'Low priority identity.', priority: 1 }),
        makeIdentity({ content: 'High priority identity.', priority: 100 }),
      ],
    });

    const result = formatContext(ctx);
    const highPos = result.indexOf('High priority identity.');
    const lowPos = result.indexOf('Low priority identity.');

    expect(highPos).toBeLessThan(lowPos);
  });

  it('truncates skill content at maxSkillLength with [...truncated] marker', () => {
    const longContent = 'A'.repeat(200);
    const ctx = makeContext({
      skills: [makeSkill({ content: longContent })],
    });

    const result = formatContext(ctx, { maxSkillLength: 50 });

    expect(result).toContain('A'.repeat(50));
    expect(result).toContain('[...truncated]');
    expect(result).not.toContain('A'.repeat(51));
  });

  it('does not truncate skill content shorter than maxSkillLength', () => {
    const ctx = makeContext({
      skills: [makeSkill({ content: 'Short content.' })],
    });

    const result = formatContext(ctx, { maxSkillLength: 200 });

    expect(result).toContain('Short content.');
    expect(result).not.toContain('[...truncated]');
  });

  it('limits number of skills to maxSkills', () => {
    const ctx = makeContext({
      skills: [
        makeSkill({ name: 'skill-a', content: 'Content A' }),
        makeSkill({ name: 'skill-b', content: 'Content B' }),
        makeSkill({ name: 'skill-c', content: 'Content C' }),
      ],
    });

    const result = formatContext(ctx, { maxSkills: 2 });

    expect(result).toContain('skill-a');
    expect(result).toContain('Content A');
    expect(result).toContain('skill-b');
    expect(result).toContain('Content B');
    expect(result).not.toContain('skill-c');
    expect(result).not.toContain('Content C');
  });

  it('combines skipIdentities + maxSkillLength + maxSkills', () => {
    const ctx = makeContext({
      identities: [makeIdentity({ content: 'You are Kiwi.' })],
      skills: [
        makeSkill({ name: 'skill-a', content: 'A'.repeat(100) }),
        makeSkill({ name: 'skill-b', content: 'B'.repeat(100) }),
        makeSkill({ name: 'skill-c', content: 'C'.repeat(100) }),
      ],
    });

    const result = formatContext(ctx, {
      skipIdentities: true,
      maxSkillLength: 20,
      maxSkills: 2,
    });

    expect(result).not.toContain('You are Kiwi.');
    expect(result).toContain('skill-a');
    expect(result).toContain('skill-b');
    expect(result).not.toContain('skill-c');
    expect(result).toContain('[...truncated]');
    expect(result).not.toContain('A'.repeat(21));
  });

  it('returns empty string when context has all empty arrays', () => {
    const ctx = makeContext();

    const result = formatContext(ctx);

    expect(result).toBe('');
  });

  it('omits routing section when model is "default"', () => {
    const ctx = makeContext({
      routing: { model: 'default', reason: 'no routing needed' },
    });

    const result = formatContext(ctx);

    expect(result).not.toContain('## Model Routing');
  });

  it('includes routing section when model is not "default"', () => {
    const ctx = makeContext({
      routing: { model: 'opus', reason: 'complex task' },
    });

    const result = formatContext(ctx);

    expect(result).toContain('## Model Routing');
    expect(result).toContain('opus');
    expect(result).toContain('complex task');
  });

  it('separates multiple sections with ---', () => {
    const ctx = makeContext({
      identities: [makeIdentity({ content: 'Identity content.' })],
      memories: [makeMemory({ content: 'A memory.' })],
    });

    const result = formatContext(ctx);

    expect(result).toContain('---');
  });

  it('skips skills without content', () => {
    const ctx = makeContext({
      skills: [
        makeSkill({ name: 'no-content', content: undefined }),
        makeSkill({ name: 'has-content', content: 'Real content' }),
      ],
    });

    const result = formatContext(ctx);

    expect(result).toContain('has-content');
    expect(result).toContain('Real content');
    expect(result).not.toContain('no-content');
  });
});
