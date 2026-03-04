import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerProvider, clearProviders, createProviders } from '../loader.js';

beforeEach(() => {
  clearProviders();
});

describe('clearProviders', () => {
  it('resets the registry so registered factories are no longer used', async () => {
    const factory = vi.fn().mockReturnValue({
      search: vi.fn().mockResolvedValue([{ content: 'custom', type: 'fact', source: 'test' }]),
      store: vi.fn().mockResolvedValue(undefined),
    });
    registerProvider('@dot-ai/provider-file-memory', factory);
    clearProviders();

    const providers = await createProviders({ memory: { use: '@dot-ai/provider-file-memory' } });
    // After clear, factory should not be called — noop provider is used
    expect(factory).not.toHaveBeenCalled();
    const memories = await providers.memory.search('query');
    expect(memories).toEqual([]);
  });
});

describe('registerProvider + createProviders', () => {
  it('uses registered memory factory', async () => {
    const customMemory = {
      search: vi.fn().mockResolvedValue([{ content: 'custom result', type: 'fact', source: 'test' }]),
      store: vi.fn().mockResolvedValue(undefined),
    };
    registerProvider('@dot-ai/custom-memory', () => customMemory);

    const providers = await createProviders({ memory: { use: '@dot-ai/custom-memory' } });
    const results = await providers.memory.search('query');
    expect(results[0]?.content).toBe('custom result');
  });

  it('passes options to the factory', async () => {
    const factory = vi.fn().mockReturnValue({
      search: vi.fn().mockResolvedValue([]),
      store: vi.fn().mockResolvedValue(undefined),
    });
    registerProvider('@dot-ai/opts-memory', factory);

    await createProviders({ memory: { use: '@dot-ai/opts-memory', with: { url: 'http://test' } } });
    expect(factory).toHaveBeenCalledWith({ url: 'http://test' });
  });

  it('supports async factory (returns Promise)', async () => {
    const customMemory = {
      search: vi.fn().mockResolvedValue([]),
      store: vi.fn().mockResolvedValue(undefined),
    };
    registerProvider('@dot-ai/async-memory', async () => customMemory);

    const providers = await createProviders({ memory: { use: '@dot-ai/async-memory' } });
    expect(providers.memory).toBe(customMemory);
  });

  it('registers and uses a skill provider', async () => {
    const mockSkills = [{ name: 'my-skill', description: 'A skill', labels: ['test'] }];
    registerProvider('@dot-ai/custom-skills', () => ({
      list: vi.fn().mockResolvedValue(mockSkills),
      match: vi.fn().mockResolvedValue([]),
      load: vi.fn().mockResolvedValue(null),
    }));

    const providers = await createProviders({ skills: { use: '@dot-ai/custom-skills' } });
    const skills = await providers.skills.list();
    expect(skills).toEqual(mockSkills);
  });

  it('registers and uses an identity provider', async () => {
    const mockIdentities = [{ type: 'agents', content: 'I am Kiwi', source: 'file', priority: 1 }];
    registerProvider('@dot-ai/custom-identity', () => ({
      load: vi.fn().mockResolvedValue(mockIdentities),
    }));

    const providers = await createProviders({ identity: { use: '@dot-ai/custom-identity' } });
    const identities = await providers.identity.load();
    expect(identities).toEqual(mockIdentities);
  });
});

describe('auto-discovery via dynamic import', () => {
  // NOTE: Dynamic import behavior is hard to mock reliably in vitest (import() is
  // module-level). Auto-discovery with real packages is tested via E2E.
  // The unit guarantee here is that an unknown provider name gracefully falls
  // back to the noop implementation (i.e. tryImportProvider returns null for
  // non-existent packages without throwing).
  it('falls back to noop when provider package does not exist', async () => {
    // '@dot-ai/nonexistent-provider' is not registered and cannot be imported
    const providers = await createProviders({ memory: { use: '@dot-ai/nonexistent-provider' } });
    const memories = await providers.memory.search('query');
    expect(memories).toEqual([]);
  });
});

describe('createProviders — noop fallbacks', () => {
  // Use non-existent provider names to ensure noop fallbacks are returned
  // (auto-discovery would find real packages for default names like @dot-ai/provider-file-memory)
  const noopConfig = {
    memory: { use: '@dot-ai/nonexistent-memory' },
    skills: { use: '@dot-ai/nonexistent-skills' },
    identity: { use: '@dot-ai/nonexistent-identity' },
    routing: { use: '@dot-ai/nonexistent-routing' },
    tasks: { use: '@dot-ai/nonexistent-tasks' },
    tools: { use: '@dot-ai/nonexistent-tools' },
  };

  it('returns noop memory provider when nothing registered', async () => {
    const providers = await createProviders(noopConfig);
    const memories = await providers.memory.search('any query');
    expect(memories).toEqual([]);
  });

  it('noop memory.store resolves without error', async () => {
    const providers = await createProviders(noopConfig);
    await expect(
      providers.memory.store({ content: 'x', type: 'log' }),
    ).resolves.toBeUndefined();
  });

  it('noop skills.list returns empty array', async () => {
    const providers = await createProviders(noopConfig);
    expect(await providers.skills.list()).toEqual([]);
  });

  it('noop skills.match returns empty array', async () => {
    const providers = await createProviders(noopConfig);
    expect(await providers.skills.match([])).toEqual([]);
  });

  it('noop skills.load returns null', async () => {
    const providers = await createProviders(noopConfig);
    expect(await providers.skills.load('any-skill')).toBeNull();
  });

  it('noop identity.load returns empty array', async () => {
    const providers = await createProviders(noopConfig);
    expect(await providers.identity.load()).toEqual([]);
  });

  it('noop routing.route returns a RoutingResult', async () => {
    const providers = await createProviders(noopConfig);
    const result = await providers.routing.route([]);
    expect(result).toHaveProperty('model');
    expect(result).toHaveProperty('reason');
    expect(typeof result.model).toBe('string');
  });

  it('noop tasks.list returns empty array', async () => {
    const providers = await createProviders(noopConfig);
    expect(await providers.tasks.list()).toEqual([]);
  });

  it('noop tasks.get returns null', async () => {
    const providers = await createProviders(noopConfig);
    expect(await providers.tasks.get('123')).toBeNull();
  });

  it('noop tasks.create returns a task with generated id', async () => {
    const providers = await createProviders(noopConfig);
    const task = await providers.tasks.create({ text: 'Do something', status: 'pending' });
    expect(task).toHaveProperty('id');
    expect(task.text).toBe('Do something');
    expect(task.status).toBe('pending');
  });

  it('noop tasks.update returns a task with the patched fields', async () => {
    const providers = await createProviders(noopConfig);
    const task = await providers.tasks.update('abc', { status: 'done' });
    expect(task.id).toBe('abc');
    expect(task.status).toBe('done');
  });

  it('noop tools.list returns empty array', async () => {
    const providers = await createProviders(noopConfig);
    expect(await providers.tools.list()).toEqual([]);
  });

  it('noop tools.match returns empty array', async () => {
    const providers = await createProviders(noopConfig);
    expect(await providers.tools.match([])).toEqual([]);
  });

  it('noop tools.load returns null', async () => {
    const providers = await createProviders(noopConfig);
    expect(await providers.tools.load('any-tool')).toBeNull();
  });
});
