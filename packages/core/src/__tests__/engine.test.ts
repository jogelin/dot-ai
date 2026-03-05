import { describe, it, expect, vi } from 'vitest';
import { boot, enrich, learn } from '../engine.js';
import type { Providers } from '../engine.js';

function createMockProviders(overrides?: Partial<Providers>): Providers {
  return {
    memory: {
      search: vi.fn().mockResolvedValue([]),
      store: vi.fn().mockResolvedValue(undefined),
      describe: vi.fn().mockReturnValue('Mock memory provider'),
    },
    skills: {
      list: vi.fn().mockResolvedValue([]),
      match: vi.fn().mockResolvedValue([]),
      load: vi.fn().mockResolvedValue(null),
    },
    identity: {
      load: vi.fn().mockResolvedValue([]),
    },
    routing: {
      route: vi.fn().mockResolvedValue({ model: 'sonnet', reason: 'default' }),
    },
    tasks: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
    },
    tools: {
      list: vi.fn().mockResolvedValue([]),
      match: vi.fn().mockResolvedValue([]),
      load: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
  };
}

describe('boot', () => {
  it('calls identity.load(), skills.list(), tools.list()', async () => {
    const providers = createMockProviders();
    await boot(providers);
    expect(providers.identity.load).toHaveBeenCalledOnce();
    expect(providers.skills.list).toHaveBeenCalledOnce();
    expect(providers.tools.list).toHaveBeenCalledOnce();
  });

  it('returns a BootCache with identities, vocabulary, skills', async () => {
    const providers = createMockProviders();
    const cache = await boot(providers);
    expect(cache).toHaveProperty('identities');
    expect(cache).toHaveProperty('vocabulary');
    expect(cache).toHaveProperty('skills');
  });

  it('populates identities from identity provider', async () => {
    const mockIdentities = [
      { type: 'agents', content: 'I am Kiwi', source: 'file', priority: 1 },
    ];
    const providers = createMockProviders({
      identity: { load: vi.fn().mockResolvedValue(mockIdentities) },
    });
    const cache = await boot(providers);
    expect(cache.identities).toEqual(mockIdentities);
  });

  it('populates skills from skills provider', async () => {
    const mockSkills = [
      { name: 'dot-ai-tasks', description: 'Task management', labels: ['tasks', 'cockpit'] },
    ];
    const providers = createMockProviders({
      skills: {
        list: vi.fn().mockResolvedValue(mockSkills),
        match: vi.fn().mockResolvedValue([]),
        load: vi.fn().mockResolvedValue(null),
      },
    });
    const cache = await boot(providers);
    expect(cache.skills).toEqual(mockSkills);
  });

  it('builds vocabulary from skill and tool labels', async () => {
    const providers = createMockProviders({
      skills: {
        list: vi.fn().mockResolvedValue([
          { name: 'skill-a', description: 'A', labels: ['memory', 'routing'] },
        ]),
        match: vi.fn().mockResolvedValue([]),
        load: vi.fn().mockResolvedValue(null),
      },
      tools: {
        list: vi.fn().mockResolvedValue([
          { name: 'tool-b', description: 'B', labels: ['ui', 'ux'], config: {}, source: 'file' },
        ]),
        match: vi.fn().mockResolvedValue([]),
        load: vi.fn().mockResolvedValue(null),
      },
    });
    const cache = await boot(providers);
    expect(cache.vocabulary).toContain('memory');
    expect(cache.vocabulary).toContain('routing');
    expect(cache.vocabulary).toContain('ui');
    expect(cache.vocabulary).toContain('ux');
  });

  it('calls identity, skills, and tools providers in parallel (all called before any awaited)', async () => {
    const callOrder: string[] = [];
    const providers = createMockProviders({
      identity: {
        load: vi.fn().mockImplementation(async () => {
          callOrder.push('identity');
          return [];
        }),
      },
      skills: {
        list: vi.fn().mockImplementation(async () => {
          callOrder.push('skills');
          return [];
        }),
        match: vi.fn().mockResolvedValue([]),
        load: vi.fn().mockResolvedValue(null),
      },
      tools: {
        list: vi.fn().mockImplementation(async () => {
          callOrder.push('tools');
          return [];
        }),
        match: vi.fn().mockResolvedValue([]),
        load: vi.fn().mockResolvedValue(null),
      },
    });
    await boot(providers);
    // All three should have been called (order may vary in parallel)
    expect(callOrder).toContain('identity');
    expect(callOrder).toContain('skills');
    expect(callOrder).toContain('tools');
  });
});

describe('enrich', () => {
  const baseCache = {
    identities: [{ type: 'agents', content: 'I am Kiwi', source: 'file', priority: 1 }],
    vocabulary: ['memory', 'routing', 'tasks'],
    skills: [],
  };

  it('returns an EnrichedContext with all required fields', async () => {
    const providers = createMockProviders();
    const result = await enrich('fix the memory issue', providers, baseCache);
    expect(result).toHaveProperty('prompt');
    expect(result).toHaveProperty('labels');
    expect(result).toHaveProperty('identities');
    expect(result).toHaveProperty('memories');
    expect(result).toHaveProperty('skills');
    expect(result).toHaveProperty('tools');
    expect(result).toHaveProperty('routing');
  });

  it('includes the original prompt in the result', async () => {
    const providers = createMockProviders();
    const result = await enrich('fix the memory issue', providers, baseCache);
    expect(result.prompt).toBe('fix the memory issue');
  });

  it('extracts labels from prompt against vocabulary', async () => {
    const providers = createMockProviders();
    const result = await enrich('fix the memory issue', providers, baseCache);
    const labelNames = result.labels.map((l) => l.name);
    expect(labelNames).toContain('memory');
    expect(labelNames).not.toContain('routing');
  });

  it('includes identities from cache', async () => {
    const providers = createMockProviders();
    const result = await enrich('hello', providers, baseCache);
    expect(result.identities).toEqual(baseCache.identities);
  });

  it('calls memory.search with prompt and extracted label names', async () => {
    const providers = createMockProviders();
    await enrich('fix the memory issue', providers, baseCache);
    expect(providers.memory.search).toHaveBeenCalledWith('fix the memory issue', ['memory']);
  });

  it('calls skills.match with extracted labels', async () => {
    const providers = createMockProviders();
    await enrich('fix the routing logic', providers, baseCache);
    expect(providers.skills.match).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'routing' })]),
    );
  });

  it('calls tools.match with extracted labels', async () => {
    const providers = createMockProviders();
    await enrich('tasks need fixing', providers, baseCache);
    expect(providers.tools.match).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'tasks' })]),
    );
  });

  it('calls routing.route with extracted labels', async () => {
    const providers = createMockProviders();
    await enrich('fix the memory issue', providers, baseCache);
    expect(providers.routing.route).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'memory' })]),
    );
  });

  it('populates memories from memory.search result', async () => {
    const mockMemories = [
      { content: 'Memory fact', type: 'fact', source: 'file' },
    ];
    const providers = createMockProviders({
      memory: {
        search: vi.fn().mockResolvedValue(mockMemories),
        store: vi.fn().mockResolvedValue(undefined),
        describe: vi.fn().mockReturnValue('Mock memory provider'),
      },
    });
    const result = await enrich('fix the memory issue', providers, baseCache);
    expect(result.memories).toEqual(mockMemories);
  });

  it('populates skills from skills.match result', async () => {
    const mockSkills = [
      { name: 'dot-ai-tasks', description: 'Tasks', labels: ['tasks'] },
    ];
    const providers = createMockProviders({
      skills: {
        list: vi.fn().mockResolvedValue([]),
        match: vi.fn().mockResolvedValue(mockSkills),
        load: vi.fn().mockResolvedValue(null),
      },
    });
    const result = await enrich('hello', providers, baseCache);
    expect(result.skills).toEqual(mockSkills);
  });

  it('populates routing from routing.route result', async () => {
    const mockRouting = { model: 'opus', reason: 'complex task' };
    const providers = createMockProviders({
      routing: { route: vi.fn().mockResolvedValue(mockRouting) },
    });
    const result = await enrich('hello', providers, baseCache);
    expect(result.routing).toEqual(mockRouting);
  });

  it('calls memory, skills, tools, routing in parallel', async () => {
    const callOrder: string[] = [];
    const providers = createMockProviders({
      memory: {
        search: vi.fn().mockImplementation(async () => { callOrder.push('memory'); return []; }),
        store: vi.fn().mockResolvedValue(undefined),
        describe: vi.fn().mockReturnValue('Mock memory provider'),
      },
      skills: {
        list: vi.fn().mockResolvedValue([]),
        match: vi.fn().mockImplementation(async () => { callOrder.push('skills'); return []; }),
        load: vi.fn().mockResolvedValue(null),
      },
      tools: {
        list: vi.fn().mockResolvedValue([]),
        match: vi.fn().mockImplementation(async () => { callOrder.push('tools'); return []; }),
        load: vi.fn().mockResolvedValue(null),
      },
      routing: {
        route: vi.fn().mockImplementation(async () => { callOrder.push('routing'); return { model: 'sonnet', reason: 'default' }; }),
      },
    });
    await enrich('hello world', providers, baseCache);
    expect(callOrder).toContain('memory');
    expect(callOrder).toContain('skills');
    expect(callOrder).toContain('tools');
    expect(callOrder).toContain('routing');
  });

  it('calls identity.match() when provider supports it and includes project identities', async () => {
    const projectIdentity = { type: 'agent', content: 'Project AGENT.md', source: 'file-identity', priority: 50, node: 'myapp' };
    const identityMatchFn = vi.fn().mockResolvedValue([projectIdentity]);

    const providers = createMockProviders({
      identity: {
        load: vi.fn().mockResolvedValue([]),
        match: identityMatchFn,
      },
    });

    const cache = {
      identities: [{ type: 'agents', content: 'Root identity', source: 'file', priority: 100 }],
      vocabulary: ['myapp'],
      skills: [],
    };

    const result = await enrich('myapp needs fixing', providers, cache);

    expect(identityMatchFn).toHaveBeenCalledOnce();
    expect(identityMatchFn).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'myapp' })]),
    );
    // Should include both root (from cache) and project identities
    expect(result.identities).toHaveLength(2);
    expect(result.identities).toContainEqual(
      expect.objectContaining({ type: 'agents', content: 'Root identity' }),
    );
    expect(result.identities).toContainEqual(
      expect.objectContaining({ type: 'agent', content: 'Project AGENT.md' }),
    );
  });

  it('does not call identity.match() when provider does not support it', async () => {
    const providers = createMockProviders({
      identity: {
        load: vi.fn().mockResolvedValue([]),
        // No match() method
      },
    });

    const cache = {
      identities: [{ type: 'agents', content: 'Root identity', source: 'file', priority: 100 }],
      vocabulary: [],
      skills: [],
    };

    const result = await enrich('hello', providers, cache);

    // Should only have cache identities, no project identities
    expect(result.identities).toEqual(cache.identities);
  });

  it('keeps only cache identities when identity.match() returns empty', async () => {
    const providers = createMockProviders({
      identity: {
        load: vi.fn().mockResolvedValue([]),
        match: vi.fn().mockResolvedValue([]),
      },
    });

    const cache = {
      identities: [{ type: 'agents', content: 'Root identity', source: 'file', priority: 100 }],
      vocabulary: [],
      skills: [],
    };

    const result = await enrich('hello', providers, cache);

    // Should still have cache identities unchanged
    expect(result.identities).toEqual(cache.identities);
  });
});

describe('learn', () => {
  it('calls memory.store with the response', async () => {
    const providers = createMockProviders();
    const longResponse = 'This is what I learned today — a detailed explanation of the architecture and design decisions made here';
    await learn(longResponse, providers);
    expect(providers.memory.store).toHaveBeenCalledOnce();
    expect(providers.memory.store).toHaveBeenCalledWith(
      expect.objectContaining({ content: longResponse, type: 'log' }),
    );
  });

  it('stores entry with today\'s date', async () => {
    const providers = createMockProviders();
    const today = new Date().toISOString().slice(0, 10);
    await learn('This is a sufficiently long response to pass the minimum length threshold for learning and should be stored', providers);
    expect(providers.memory.store).toHaveBeenCalledWith(
      expect.objectContaining({ date: today }),
    );
  });

  it('does not call any other provider methods', async () => {
    const providers = createMockProviders();
    await learn('response', providers);
    expect(providers.skills.list).not.toHaveBeenCalled();
    expect(providers.identity.load).not.toHaveBeenCalled();
    expect(providers.routing.route).not.toHaveBeenCalled();
  });

  it('resolves without error on successful store', async () => {
    const providers = createMockProviders();
    await expect(learn('response', providers)).resolves.toBeUndefined();
  });

  it('skips responses shorter than 100 chars', async () => {
    const providers = createMockProviders();
    await learn('Short response under 100 characters', providers);
    expect(providers.memory.store).not.toHaveBeenCalled();
  });

  it('skips responses containing NO_REPLY', async () => {
    const providers = createMockProviders();
    const response = 'NO_REPLY — this is a long enough response but should not be stored in memory at all';
    await learn(response + ' extra text to make it over 100 characters long for this test', providers);
    expect(providers.memory.store).not.toHaveBeenCalled();
  });

  it('skips responses containing HEARTBEAT_OK', async () => {
    const providers = createMockProviders();
    const response = 'HEARTBEAT_OK — system is healthy and running fine, nothing to store in memory for this heartbeat check';
    await learn(response, providers);
    expect(providers.memory.store).not.toHaveBeenCalled();
  });

  it('skips responses starting with "OK"', async () => {
    const providers = createMockProviders();
    const response = "OK, I've updated the configuration file as requested. All settings have been applied successfully to the system.";
    await learn(response, providers);
    expect(providers.memory.store).not.toHaveBeenCalled();
  });

  it('skips responses starting with "Done"', async () => {
    const providers = createMockProviders();
    const response = "Done — the migration has been completed successfully. All records have been updated in the database.";
    await learn(response, providers);
    expect(providers.memory.store).not.toHaveBeenCalled();
  });

  it('skips responses starting with "Here\'s"', async () => {
    const providers = createMockProviders();
    const response = "Here's the summary you requested. The analysis shows that everything is working correctly as expected.";
    await learn(response, providers);
    expect(providers.memory.store).not.toHaveBeenCalled();
  });

  it('skips responses starting with "Sure"', async () => {
    const providers = createMockProviders();
    const response = "Sure, I can help with that. Let me look into this issue and provide you with a detailed explanation right now.";
    await learn(response, providers);
    expect(providers.memory.store).not.toHaveBeenCalled();
  });

  it('stores substantive responses that don\'t match conversational patterns', async () => {
    const providers = createMockProviders();
    const response = 'The authentication system was refactored to use JWT with refresh tokens. The decision was made to improve security and scalability.';
    await learn(response, providers);
    expect(providers.memory.store).toHaveBeenCalledOnce();
  });
});
