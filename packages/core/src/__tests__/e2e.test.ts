import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadConfig,
  resolveConfig,
  registerDefaults,
  clearProviders,
  createProviders,
  boot,
  enrich,
  learn,
} from '../index.js';

describe('E2E: full pipeline', () => {
  let root: string;

  beforeEach(async () => {
    clearProviders();
    registerDefaults();

    root = await mkdtemp(join(tmpdir(), 'dot-ai-e2e-'));
    const ai = join(root, '.ai');

    // Create .ai/ structure
    await mkdir(ai, { recursive: true });
    await mkdir(join(ai, 'memory'), { recursive: true });
    await mkdir(join(ai, 'skills', 'ts-standards'), { recursive: true });
    await mkdir(join(ai, 'skills', 'code-review'), { recursive: true });
    await mkdir(join(ai, 'tools'), { recursive: true });

    // Identity files
    await writeFile(join(ai, 'AGENTS.md'), '# AGENTS.md\n\nYou are Kiwi, a helpful assistant.\n\n## Rules\n- Always be concise\n- Use TypeScript');
    await writeFile(join(ai, 'SOUL.md'), '# SOUL.md\n\nBe genuine. Skip the fluff.');
    await writeFile(join(ai, 'USER.md'), '# USER.md\n\nJo, developer, Belgium.');
    await writeFile(join(ai, 'IDENTITY.md'), '# IDENTITY.md\n\nName: Kiwi\nEmoji: 🥝');

    // Skills with frontmatter
    await writeFile(join(ai, 'skills', 'ts-standards', 'SKILL.md'), [
      '---',
      'description: TypeScript coding standards',
      'labels: [typescript, code, standards]',
      'triggers: [auto]',
      '---',
      '',
      '## TypeScript Standards',
      '',
      '- Use strict mode',
      '- Prefer const over let',
      '- Add type annotations',
    ].join('\n'));

    await writeFile(join(ai, 'skills', 'code-review', 'SKILL.md'), [
      '---',
      'description: Code review guidelines',
      'labels: [review, code-fix, bug]',
      'triggers: [auto]',
      '---',
      '',
      '## Code Review',
      '',
      '- Check for edge cases',
      '- Verify error handling',
    ].join('\n'));

    // Tools
    await writeFile(join(ai, 'tools', 'eslint.yaml'), [
      'name: eslint',
      'description: TypeScript linter',
      'labels: [typescript, lint, code]',
    ].join('\n'));

    // Memory (some past entries)
    await writeFile(join(ai, 'memory', '2026-03-01.md'), [
      '- Fixed auth middleware N+1 query bug',
      '- Decided to use JWT for auth tokens',
      '- Rate limiting added to auth endpoints',
    ].join('\n'));

    await writeFile(join(ai, 'memory', '2026-03-02.md'), [
      '- Refactored database connection pooling',
      '- Updated React test suite to use vitest',
    ].join('\n'));

    // Config — uses 4-space indent for 'with' block (parsed as options)
    // The parser maps 4-space keys directly into section.with
    await writeFile(join(ai, 'dot-ai.yml'), [
      '# dot-ai config',
      'memory:',
      '  use: @dot-ai/file-memory',
      `    root: ${root}`,
      'skills:',
      '  use: @dot-ai/file-skills',
      `    root: ${root}`,
      'identity:',
      '  use: @dot-ai/file-identity',
      `    root: ${root}`,
      'routing:',
      '  use: @dot-ai/rules-routing',
      'tasks:',
      '  use: @dot-ai/file-tasks',
      `    root: ${root}`,
      'tools:',
      '  use: @dot-ai/file-tools',
      `    root: ${root}`,
    ].join('\n'));
  });

  it('runs the complete pipeline: config → providers → boot → enrich', async () => {
    // 1. Load config
    const config = await loadConfig(root);
    expect(config).toBeDefined();

    // 2. Create providers
    const providers = await createProviders(config);
    expect(providers).toBeDefined();
    expect(providers.memory).toBeDefined();
    expect(providers.skills).toBeDefined();
    expect(providers.identity).toBeDefined();
    expect(providers.routing).toBeDefined();
    expect(providers.tasks).toBeDefined();
    expect(providers.tools).toBeDefined();

    // 3. Boot
    const cache = await boot(providers);
    expect(cache.identities.length).toBe(4); // AGENTS, SOUL, USER, IDENTITY
    expect(cache.skills.length).toBe(2); // ts-standards, code-review
    expect(cache.vocabulary.length).toBeGreaterThan(0);
    expect(cache.vocabulary).toContain('typescript');
    expect(cache.vocabulary).toContain('code');

    // 4. Enrich a prompt
    const ctx = await enrich('Fix the TypeScript bug in the auth module', providers, cache);

    // Check labels extracted
    expect(ctx.labels.length).toBeGreaterThan(0);
    expect(ctx.labels.some(l => l.name === 'typescript')).toBe(true);

    // Check identities loaded
    expect(ctx.identities.length).toBe(4);
    expect(ctx.identities.find(i => i.type === 'agents')?.content).toContain('Kiwi');

    // Check memories found (should match "auth" and/or "bug")
    expect(ctx.memories.length).toBeGreaterThan(0);
    expect(ctx.memories.some(m => m.content.includes('auth'))).toBe(true);

    // Check skills matched (typescript label should match ts-standards)
    expect(ctx.skills.length).toBeGreaterThan(0);
    expect(ctx.skills.some(s => s.name === 'ts-standards')).toBe(true);

    // Check tools matched (typescript label should match eslint)
    expect(ctx.tools.length).toBeGreaterThan(0);
    expect(ctx.tools.some(t => t.name === 'eslint')).toBe(true);

    // Check routing (code-fix → sonnet)
    expect(ctx.routing.model).toBeDefined();
  });

  it('enriches differently for different prompts', async () => {
    const config = await loadConfig(root);
    const providers = await createProviders(config);
    const cache = await boot(providers);

    // A code-related prompt should match code skills and tools
    const codeFix = await enrich('Fix the TypeScript bug', providers, cache);
    expect(codeFix.skills.some(s => s.name === 'ts-standards')).toBe(true);
    expect(codeFix.tools.some(t => t.name === 'eslint')).toBe(true);

    // A review-related prompt should match code-review skill
    const review = await enrich('Review this code for bugs', providers, cache);
    expect(review.skills.some(s => s.name === 'code-review')).toBe(true);
  });

  it('learns from agent responses and retrieves later', async () => {
    const config = await loadConfig(root);
    const providers = await createProviders(config);
    const cache = await boot(providers);

    // Learn something
    await learn('Discovered that the connection pool was configured wrong', providers);

    // Should be retrievable via memory search
    const ctx = await enrich('What about the connection pool?', providers, cache);
    expect(ctx.memories.some(m => m.content.includes('connection pool'))).toBe(true);
  });

  it('works with empty .ai/ directory (minimal config)', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'dot-ai-empty-'));
    await mkdir(join(emptyRoot, '.ai'), { recursive: true });
    await writeFile(join(emptyRoot, '.ai', 'dot-ai.yml'), '# empty config');

    const config = await loadConfig(emptyRoot);
    // Inject root so providers read from the empty dir (not process.cwd())
    const resolvedConfig = {
      memory: { use: '@dot-ai/file-memory', with: { root: emptyRoot } },
      skills: { use: '@dot-ai/file-skills', with: { root: emptyRoot } },
      identity: { use: '@dot-ai/file-identity', with: { root: emptyRoot } },
      routing: { use: '@dot-ai/rules-routing' },
      tasks: { use: '@dot-ai/file-tasks', with: { root: emptyRoot } },
      tools: { use: '@dot-ai/file-tools', with: { root: emptyRoot } },
      ...config,
    };
    const providers = await createProviders(resolvedConfig);
    const cache = await boot(providers);

    expect(cache.identities).toEqual([]);
    expect(cache.skills).toEqual([]);
    expect(cache.vocabulary).toEqual([]);

    const ctx = await enrich('Hello', providers, cache);
    expect(ctx.identities).toEqual([]);
    expect(ctx.memories).toEqual([]);
    expect(ctx.skills).toEqual([]);
  });

  it('unregistered provider falls back to noop gracefully', async () => {
    // Auto-discovery: when a provider name is not in the registry and cannot be
    // dynamically imported (e.g. package doesn't exist), createProviders must
    // return a working noop instead of throwing.
    clearProviders(); // no defaults registered
    const providers = await createProviders({
      memory: { use: '@dot-ai/nonexistent-memory-provider' },
    });
    // Should not throw — noop memory is returned
    const memories = await providers.memory.search('anything');
    expect(memories).toEqual([]);
    await expect(
      providers.memory.store({ content: 'x', type: 'log' }),
    ).resolves.toBeUndefined();
  });

  it('boot caches skills and vocabulary for reuse across prompts', async () => {
    const config = await loadConfig(root);
    const providers = await createProviders(config);
    const cache = await boot(providers);

    // Run enrich multiple times — should all use same cache
    const ctx1 = await enrich('Fix typescript', providers, cache);
    const ctx2 = await enrich('Review code', providers, cache);
    const ctx3 = await enrich('Something unrelated', providers, cache);

    // All should have same identities from cache
    expect(ctx1.identities).toEqual(ctx2.identities);
    expect(ctx2.identities).toEqual(ctx3.identities);
  });

  it('resolveConfig fills defaults for missing providers', () => {
    const resolved = resolveConfig({});
    expect(resolved.memory.use).toBe('@dot-ai/file-memory');
    expect(resolved.skills.use).toBe('@dot-ai/file-skills');
    expect(resolved.identity.use).toBe('@dot-ai/file-identity');
    expect(resolved.routing.use).toBe('@dot-ai/rules-routing');
    expect(resolved.tasks.use).toBe('@dot-ai/file-tasks');
    expect(resolved.tools.use).toBe('@dot-ai/file-tools');
  });
});
