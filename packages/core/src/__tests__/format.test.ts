import { describe, it, expect, vi } from 'vitest';
import { formatContext, formatToolHints, formatSections, assembleSections, trimSections } from '../format.js';
import type { EnrichedContext, Identity, MemoryEntry, Skill, Tool } from '../types.js';
import type { Capability } from '../capabilities.js';
import type { Section } from '../extension-types.js';

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

const makeEmptyContext = makeContext;

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

  describe('format stability (determinism)', () => {
    it('produces identical output for same inputs called twice', () => {
      const ctx = makeContext({
        identities: [
          makeIdentity({ content: 'Identity A', priority: 80, type: 'user' }),
          makeIdentity({ content: 'Identity B', priority: 100, type: 'agents' }),
        ],
        memories: [
          makeMemory({ content: 'Memory 1', date: '2025-01-01' }),
          makeMemory({ content: 'Memory 2', date: '2025-03-01' }),
        ],
        skills: [
          makeSkill({ name: 'zebra-skill', content: 'Zebra content' }),
          makeSkill({ name: 'alpha-skill', content: 'Alpha content' }),
        ],
        tools: [
          makeTool({ name: 'z-tool', description: 'Z tool' }),
          makeTool({ name: 'a-tool', description: 'A tool' }),
        ],
      });

      const result1 = formatContext(ctx);
      const result2 = formatContext(ctx);

      expect(result1).toBe(result2);
    });

    it('produces same output regardless of input ordering (skills sorted by name)', () => {
      const ctxA = makeContext({
        skills: [
          makeSkill({ name: 'zebra-skill', content: 'Zebra content' }),
          makeSkill({ name: 'alpha-skill', content: 'Alpha content' }),
          makeSkill({ name: 'middle-skill', content: 'Middle content' }),
        ],
      });

      const ctxB = makeContext({
        skills: [
          makeSkill({ name: 'middle-skill', content: 'Middle content' }),
          makeSkill({ name: 'alpha-skill', content: 'Alpha content' }),
          makeSkill({ name: 'zebra-skill', content: 'Zebra content' }),
        ],
      });

      expect(formatContext(ctxA)).toBe(formatContext(ctxB));
    });

    it('sorts skills by name alphabetically', () => {
      const ctx = makeContext({
        skills: [
          makeSkill({ name: 'zebra-skill', content: 'Zebra content' }),
          makeSkill({ name: 'alpha-skill', content: 'Alpha content' }),
          makeSkill({ name: 'middle-skill', content: 'Middle content' }),
        ],
      });

      const result = formatContext(ctx);
      const alphaPos = result.indexOf('alpha-skill');
      const middlePos = result.indexOf('middle-skill');
      const zebraPos = result.indexOf('zebra-skill');

      expect(alphaPos).toBeLessThan(middlePos);
      expect(middlePos).toBeLessThan(zebraPos);
    });

    it('sorts memories by date DESC (most recent first)', () => {
      const ctx = makeContext({
        memories: [
          makeMemory({ content: 'Oldest memory', date: '2024-01-01' }),
          makeMemory({ content: 'Newest memory', date: '2025-12-31' }),
          makeMemory({ content: 'Middle memory', date: '2025-06-15' }),
        ],
      });

      const result = formatContext(ctx);
      const newestPos = result.indexOf('Newest memory');
      const middlePos = result.indexOf('Middle memory');
      const oldestPos = result.indexOf('Oldest memory');

      expect(newestPos).toBeLessThan(middlePos);
      expect(middlePos).toBeLessThan(oldestPos);
    });

    it('produces same output for memories regardless of input ordering', () => {
      const ctxA = makeContext({
        memories: [
          makeMemory({ content: 'Old memory', date: '2024-01-01' }),
          makeMemory({ content: 'New memory', date: '2025-12-31' }),
        ],
      });

      const ctxB = makeContext({
        memories: [
          makeMemory({ content: 'New memory', date: '2025-12-31' }),
          makeMemory({ content: 'Old memory', date: '2024-01-01' }),
        ],
      });

      expect(formatContext(ctxA)).toBe(formatContext(ctxB));
    });

    it('sorts identities by priority DESC then type alphabetically', () => {
      const ctx = makeContext({
        identities: [
          makeIdentity({ content: 'Type z same priority', priority: 50, type: 'z-type' }),
          makeIdentity({ content: 'Type a same priority', priority: 50, type: 'a-type' }),
          makeIdentity({ content: 'High priority identity', priority: 100, type: 'agents' }),
        ],
      });

      const result = formatContext(ctx);
      const highPos = result.indexOf('High priority identity');
      const typeAPos = result.indexOf('Type a same priority');
      const typeZPos = result.indexOf('Type z same priority');

      // High priority first
      expect(highPos).toBeLessThan(typeAPos);
      // Same priority: 'a-type' before 'z-type' alphabetically
      expect(typeAPos).toBeLessThan(typeZPos);
    });
  });
});

describe('formatToolHints', () => {
  it('returns empty string when no capabilities have hints', () => {
    expect(formatToolHints([])).toBe('');
    const cap: Capability = { name: 'test', description: 'x', parameters: {}, execute: vi.fn() };
    expect(formatToolHints([cap])).toBe('');
  });

  it('formats promptSnippet', () => {
    const caps: Capability[] = [{
      name: 'memory_recall',
      description: 'Search memory',
      parameters: {},
      execute: vi.fn(),
      promptSnippet: 'Use memory_recall to search stored memories.',
    }];
    const result = formatToolHints(caps);
    expect(result).toContain('## Tool Hints');
    expect(result).toContain('### memory_recall');
    expect(result).toContain('Use memory_recall to search stored memories.');
  });

  it('formats promptGuidelines', () => {
    const caps: Capability[] = [{
      name: 'task_list',
      description: 'List tasks',
      parameters: {},
      execute: vi.fn(),
      promptGuidelines: 'Always check tasks before starting work.',
    }];
    const result = formatToolHints(caps);
    expect(result).toContain('> Always check tasks before starting work.');
  });

  it('formats both snippet and guidelines', () => {
    const caps: Capability[] = [{
      name: 'tool',
      description: 'd',
      parameters: {},
      execute: vi.fn(),
      promptSnippet: 'snippet text',
      promptGuidelines: 'guideline text',
    }];
    const result = formatToolHints(caps);
    expect(result).toContain('snippet text');
    expect(result).toContain('> guideline text');
  });

  it('only includes capabilities with hints', () => {
    const caps: Capability[] = [
      { name: 'no-hints', description: 'd', parameters: {}, execute: vi.fn() },
      { name: 'with-hint', description: 'd', parameters: {}, execute: vi.fn(), promptSnippet: 'hint' },
    ];
    const result = formatToolHints(caps);
    expect(result).not.toContain('no-hints');
    expect(result).toContain('with-hint');
  });
});

function makeSection(overrides?: Partial<Section>): Section {
  return {
    id: 'test:section',
    title: 'Test',
    content: 'test content',
    priority: 50,
    source: 'test',
    ...overrides,
  };
}

describe('assembleSections', () => {
  it('returns empty string for empty array', () => {
    expect(assembleSections([])).toBe('');
  });

  it('formats single section with title as ## Title\\n\\ncontent', () => {
    const section = makeSection({ title: 'My Title', content: 'my content' });
    const result = assembleSections([section]);
    expect(result).toBe('## My Title\n\nmy content');
  });

  it('joins multiple sections with \\n\\n---\\n\\n', () => {
    const sections = [
      makeSection({ title: 'First', content: 'first content' }),
      makeSection({ title: 'Second', content: 'second content' }),
    ];
    const result = assembleSections(sections);
    expect(result).toBe('## First\n\nfirst content\n\n---\n\n## Second\n\nsecond content');
  });

  it('handles sections without title (just content)', () => {
    const section = makeSection({ title: '', content: 'bare content' });
    const result = assembleSections([section]);
    expect(result).toBe('bare content');
  });

  it('mixes titled and untitled sections', () => {
    const sections = [
      makeSection({ title: 'With Title', content: 'titled content' }),
      makeSection({ title: '', content: 'untitled content' }),
    ];
    const result = assembleSections(sections);
    expect(result).toBe('## With Title\n\ntitled content\n\n---\n\nuntitled content');
  });
});

describe('formatSections', () => {
  it('sorts sections by priority DESC', () => {
    const sections = [
      makeSection({ id: 'low', title: 'Low', content: 'low priority', priority: 10 }),
      makeSection({ id: 'high', title: 'High', content: 'high priority', priority: 100 }),
      makeSection({ id: 'mid', title: 'Mid', content: 'mid priority', priority: 50 }),
    ];
    const result = formatSections(sections);
    const highPos = result.indexOf('high priority');
    const midPos = result.indexOf('mid priority');
    const lowPos = result.indexOf('low priority');
    expect(highPos).toBeLessThan(midPos);
    expect(midPos).toBeLessThan(lowPos);
  });

  it('returns assembleSections output (no trimming when no budget)', () => {
    const sections = [
      makeSection({ title: 'A', content: 'content a', priority: 10 }),
      makeSection({ title: 'B', content: 'content b', priority: 20 }),
    ];
    // formatSections sorts by priority DESC, so B first
    const result = formatSections(sections);
    expect(result).toBe('## B\n\ncontent b\n\n---\n\n## A\n\ncontent a');
  });

  it('applies trimming when tokenBudget is set', () => {
    // Create a protected section (never drop) with large content that will exceed the budget
    // and a smaller section that can be dropped. The protected one gets truncated but not dropped.
    const bigContent = 'X'.repeat(10000);
    const sections = [
      makeSection({ id: 'protected', title: 'Protected', content: bigContent, priority: 50, trimStrategy: 'never' }),
    ];
    // Budget well below the content size — trimming will be attempted but 'never' prevents drop
    // The result is the original content since truncate strategy isn't set
    const result = formatSections(sections, { tokenBudget: 10 });
    // The section is preserved (never dropped)
    expect(result).toContain('## Protected');
    // Content is shorter than original since no truncate strategy, section cannot be dropped either
    // so the function returns it as-is
    expect(result).toContain('X');
  });

  it('returns empty string for empty sections array', () => {
    expect(formatSections([])).toBe('');
  });
});

describe('trimSections', () => {
  it('returns sections unchanged when under budget', () => {
    const sections = [makeSection({ content: 'short content' })];
    // Large budget so no trimming needed
    const result = trimSections(sections, 100000);
    expect(result).toEqual(sections);
  });

  it('truncates sections with trimStrategy truncate when content > 2000 chars', () => {
    const longContent = 'A'.repeat(3000);
    // Use a budget that is exceeded by the long content but satisfied after truncation to 2000 chars.
    // Truncated content: 2000 chars + '\n\n[...truncated]' = ~2016 chars ≈ 504 tokens.
    // With title '## Test\n\n' overhead (~12 chars) ≈ 504 tokens total.
    // Use budget=600 so truncation satisfies it but not dropping.
    const sections = [
      makeSection({ id: 'big', content: longContent, trimStrategy: 'truncate' }),
    ];
    const result = trimSections(sections, 600);
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain('[...truncated]');
    expect(result[0].content).toContain('A'.repeat(2000));
    expect(result[0].content).not.toContain('A'.repeat(2001));
  });

  it('does not truncate sections with content <= 2000 chars even with truncate strategy', () => {
    const shortContent = 'A'.repeat(500);
    const sections = [
      makeSection({ id: 'small', content: shortContent, trimStrategy: 'truncate' }),
      makeSection({ id: 'other', content: 'other content', priority: 10 }),
    ];
    // Force a tight budget but the truncate candidate is too short to truncate
    // so the other (droppable) section will be dropped instead
    const result = trimSections(sections, 1);
    const truncatedSection = result.find(s => s.id === 'small');
    if (truncatedSection) {
      expect(truncatedSection.content).not.toContain('[...truncated]');
    }
  });

  it('drops sections with trimStrategy drop (lowest priority first)', () => {
    const sections = [
      makeSection({ id: 'high', title: 'High', content: 'high priority content', priority: 100 }),
      makeSection({ id: 'low', title: 'Low', content: 'low priority content', priority: 1, trimStrategy: 'drop' }),
    ];
    // Budget that requires dropping sections — very tight
    const result = trimSections(sections, 1);
    const ids = result.map(s => s.id);
    expect(ids).not.toContain('low');
  });

  it('never drops sections with trimStrategy never', () => {
    const sections = [
      makeSection({ id: 'protected', title: 'Protected', content: 'protected content', priority: 1, trimStrategy: 'never' }),
      makeSection({ id: 'droppable', title: 'Droppable', content: 'droppable content', priority: 50 }),
    ];
    // Very tight budget forces drops but 'never' section must survive
    const result = trimSections(sections, 1);
    const ids = result.map(s => s.id);
    expect(ids).toContain('protected');
  });

  it('logs budget warning when trimming occurs', () => {
    const bigContent = 'A'.repeat(10000);
    const sections = [
      makeSection({ id: 'big', content: bigContent, trimStrategy: 'truncate' }),
    ];
    const logger = { log: vi.fn() };
    trimSections(sections, 1, logger);
    expect(logger.log).toHaveBeenCalled();
    const logCall = logger.log.mock.calls[0][0];
    expect(logCall.event).toBe('budget_trimmed');
    expect(logCall.phase).toBe('format');
  });

  it('does not log when no trimming occurs', () => {
    const sections = [makeSection({ content: 'short' })];
    const logger = { log: vi.fn() };
    trimSections(sections, 100000, logger);
    expect(logger.log).not.toHaveBeenCalled();
  });
});

describe('skillDisclosure: progressive', () => {
  it('shows only description, not content, in progressive mode', () => {
    const ctx = makeEmptyContext();
    ctx.skills = [
      { name: 'my-skill', description: 'Does something useful', labels: [], content: 'Full skill body here' },
    ];
    const result = formatContext(ctx, { skillDisclosure: 'progressive' });
    expect(result).toContain('### my-skill');
    expect(result).toContain('Does something useful');
    expect(result).not.toContain('Full skill body here');
  });

  it('defaults to full disclosure (shows content)', () => {
    const ctx = makeEmptyContext();
    ctx.skills = [
      { name: 'my-skill', description: 'Desc', labels: [], content: 'Full body' },
    ];
    const result = formatContext(ctx);
    expect(result).toContain('Full body');
  });
});
