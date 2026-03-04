import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadConfig,
  registerDefaults,
  clearProviders,
  createProviders,
  boot,
  enrich,
} from '@dot-ai/core';

// ── init command logic ───────────────────────────────────────────────────────

async function runInit(root: string): Promise<string> {
  const aiDir = join(root, '.ai');
  const lines: string[] = [];

  try {
    await access(join(aiDir, 'dot-ai.yml'));
    lines.push('.ai/dot-ai.yml already exists. Nothing to do.');
    return lines.join('\n');
  } catch {
    // Doesn't exist, create it
  }

  await mkdir(aiDir, { recursive: true });

  await writeFile(join(aiDir, 'dot-ai.yml'), [
    '# dot-ai configuration',
    '# Uncomment and customize providers as needed.',
    '# Default: file-based providers reading from .ai/ directory.',
    '#',
    '# memory:',
    '#   use: "@dot-ai/provider-file-memory"',
    '#',
    '# skills:',
    '#   use: "@dot-ai/provider-file-skills"',
    '#',
    '# routing:',
    '#   use: "@dot-ai/provider-rules-routing"',
    '',
  ].join('\n'));

  await writeFile(join(aiDir, 'AGENTS.md'), [
    '# AGENTS.md',
    '',
    '> Your workspace rules and conventions go here.',
    '',
    '## Rules',
    '',
    '- ...',
    '',
  ].join('\n'));

  lines.push('Created:');
  lines.push('  .ai/dot-ai.yml    (config)');
  lines.push('  .ai/AGENTS.md     (template)');
  lines.push('\nNext: add SOUL.md, USER.md, skills/, memory/ as needed.');
  return lines.join('\n');
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function setupAiDir(root: string): Promise<void> {
  const ai = join(root, '.ai');
  await mkdir(ai, { recursive: true });
  await mkdir(join(ai, 'memory'), { recursive: true });
  await mkdir(join(ai, 'skills', 'ts-standards'), { recursive: true });
  await mkdir(join(ai, 'skills', 'code-review'), { recursive: true });
  await mkdir(join(ai, 'tools'), { recursive: true });

  await writeFile(join(ai, 'AGENTS.md'), '# AGENTS.md\n\nYou are Kiwi.');
  await writeFile(join(ai, 'SOUL.md'), '# SOUL.md\n\nBe genuine.');
  await writeFile(join(ai, 'USER.md'), '# USER.md\n\nJo, developer.');
  await writeFile(join(ai, 'IDENTITY.md'), '# IDENTITY.md\n\nName: Kiwi');

  await writeFile(join(ai, 'skills', 'ts-standards', 'SKILL.md'), [
    '---',
    'description: TypeScript coding standards',
    'labels: [typescript, code, standards]',
    'triggers: [auto]',
    '---',
    '',
    '## TypeScript Standards',
    '- Use strict mode',
  ].join('\n'));

  await writeFile(join(ai, 'skills', 'code-review', 'SKILL.md'), [
    '---',
    'description: Code review guidelines',
    'labels: [review, code-fix, bug]',
    'triggers: [auto]',
    '---',
    '',
    '## Code Review',
    '- Check for edge cases',
  ].join('\n'));

  await writeFile(join(ai, 'tools', 'eslint.yaml'), [
    'name: eslint',
    'description: TypeScript linter',
    'labels: [typescript, lint, code]',
  ].join('\n'));

  await writeFile(join(ai, 'memory', '2026-03-01.md'), [
    '- Fixed auth middleware N+1 query bug',
    '- Decided to use JWT for auth tokens',
  ].join('\n'));

  await writeFile(join(ai, 'dot-ai.yml'), [
    '# dot-ai config',
    'memory:',
    '  use: @dot-ai/provider-file-memory',
    `    root: ${root}`,
    'skills:',
    '  use: @dot-ai/provider-file-skills',
    `    root: ${root}`,
    'identity:',
    '  use: @dot-ai/provider-file-identity',
    `    root: ${root}`,
    'routing:',
    '  use: @dot-ai/provider-rules-routing',
    'tasks:',
    '  use: @dot-ai/provider-file-tasks',
    `    root: ${root}`,
    'tools:',
    '  use: @dot-ai/provider-file-tools',
    `    root: ${root}`,
  ].join('\n'));
}

// ── init tests ───────────────────────────────────────────────────────────────

describe('init command', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dot-ai-cli-init-'));
  });

  it('creates .ai/dot-ai.yml in empty directory', async () => {
    await runInit(root);
    const content = await readFile(join(root, '.ai', 'dot-ai.yml'), 'utf8');
    expect(content).toContain('# dot-ai configuration');
  });

  it('creates .ai/AGENTS.md in empty directory', async () => {
    await runInit(root);
    const content = await readFile(join(root, '.ai', 'AGENTS.md'), 'utf8');
    expect(content).toContain('# AGENTS.md');
  });

  it('dot-ai.yml contains commented provider examples', async () => {
    await runInit(root);
    const content = await readFile(join(root, '.ai', 'dot-ai.yml'), 'utf8');
    expect(content).toContain('@dot-ai/provider-file-memory');
    expect(content).toContain('@dot-ai/provider-file-skills');
    expect(content).toContain('@dot-ai/provider-rules-routing');
  });

  it('AGENTS.md is a template with ## Rules section', async () => {
    await runInit(root);
    const content = await readFile(join(root, '.ai', 'AGENTS.md'), 'utf8');
    expect(content).toContain('## Rules');
  });

  it('does nothing if dot-ai.yml already exists', async () => {
    await mkdir(join(root, '.ai'), { recursive: true });
    await writeFile(join(root, '.ai', 'dot-ai.yml'), '# existing config\n');

    const output = await runInit(root);

    expect(output).toContain('already exists');
    // File should be unchanged
    const content = await readFile(join(root, '.ai', 'dot-ai.yml'), 'utf8');
    expect(content).toBe('# existing config\n');
  });

  it('works if .ai/ directory already exists without dot-ai.yml', async () => {
    await mkdir(join(root, '.ai'), { recursive: true });
    await writeFile(join(root, '.ai', 'AGENTS.md'), '# existing\n');

    await runInit(root);

    // dot-ai.yml should be created
    const content = await readFile(join(root, '.ai', 'dot-ai.yml'), 'utf8');
    expect(content).toContain('# dot-ai configuration');
  });
});

// ── boot command logic ────────────────────────────────────────────────────────

describe('boot command (core pipeline)', () => {
  let root: string;

  beforeEach(async () => {
    clearProviders();
    registerDefaults();
    root = await mkdtemp(join(tmpdir(), 'dot-ai-cli-boot-'));
    await setupAiDir(root);
  });

  it('loads config and creates providers', async () => {
    const config = await loadConfig(root);
    const providers = await createProviders(config);
    expect(providers.memory).toBeDefined();
    expect(providers.skills).toBeDefined();
    expect(providers.identity).toBeDefined();
    expect(providers.routing).toBeDefined();
    expect(providers.tools).toBeDefined();
  });

  it('boot returns identities, skills, vocabulary', async () => {
    const config = await loadConfig(root);
    const providers = await createProviders(config);
    const cache = await boot(providers);

    expect(cache.identities.length).toBe(4); // AGENTS, SOUL, USER, IDENTITY
    expect(cache.skills.length).toBe(2);     // ts-standards, code-review
    expect(cache.vocabulary.length).toBeGreaterThan(0);
  });

  it('vocabulary contains labels from skills and tools', async () => {
    const config = await loadConfig(root);
    const providers = await createProviders(config);
    const cache = await boot(providers);

    expect(cache.vocabulary).toContain('typescript');
    expect(cache.vocabulary).toContain('code');
    expect(cache.vocabulary).toContain('bug');
  });

  it('identities have correct types', async () => {
    const config = await loadConfig(root);
    const providers = await createProviders(config);
    const cache = await boot(providers);

    const types = cache.identities.map(i => i.type);
    expect(types).toContain('agents');
    expect(types).toContain('soul');
    expect(types).toContain('user');
    expect(types).toContain('identity');
  });
});

// ── trace command logic ───────────────────────────────────────────────────────

describe('trace command (enrich pipeline)', () => {
  let root: string;

  beforeEach(async () => {
    clearProviders();
    registerDefaults();
    root = await mkdtemp(join(tmpdir(), 'dot-ai-cli-trace-'));
    await setupAiDir(root);
  });

  it('enrich returns labels matching prompt vocabulary', async () => {
    const config = await loadConfig(root);
    const providers = await createProviders(config);
    const cache = await boot(providers);

    const ctx = await enrich('Fix the TypeScript bug', providers, cache);

    expect(ctx.labels.some(l => l.name === 'typescript')).toBe(true);
    expect(ctx.labels.some(l => l.name === 'bug')).toBe(true);
  });

  it('enrich returns matched skills for typescript prompt', async () => {
    const config = await loadConfig(root);
    const providers = await createProviders(config);
    const cache = await boot(providers);

    const ctx = await enrich('Fix the TypeScript code', providers, cache);

    expect(ctx.skills.some(s => s.name === 'ts-standards')).toBe(true);
  });

  it('enrich returns matched tools for typescript prompt', async () => {
    const config = await loadConfig(root);
    const providers = await createProviders(config);
    const cache = await boot(providers);

    const ctx = await enrich('Fix the TypeScript bug', providers, cache);

    expect(ctx.tools.some(t => t.name === 'eslint')).toBe(true);
  });

  it('enrich returns memories related to prompt', async () => {
    const config = await loadConfig(root);
    const providers = await createProviders(config);
    const cache = await boot(providers);

    const ctx = await enrich('Fix the auth bug', providers, cache);

    expect(ctx.memories.some(m => m.content.includes('auth'))).toBe(true);
  });

  it('enrich returns routing result', async () => {
    const config = await loadConfig(root);
    const providers = await createProviders(config);
    const cache = await boot(providers);

    const ctx = await enrich('Fix the bug', providers, cache);

    expect(ctx.routing.model).toBeDefined();
    expect(ctx.routing.reason).toBeDefined();
  });

  it('enrich returns identities from boot cache', async () => {
    const config = await loadConfig(root);
    const providers = await createProviders(config);
    const cache = await boot(providers);

    const ctx = await enrich('anything', providers, cache);

    expect(ctx.identities.length).toBe(4);
  });

  it('enrich with unrelated prompt returns no matched skills', async () => {
    const config = await loadConfig(root);
    const providers = await createProviders(config);
    const cache = await boot(providers);

    // "hello world" doesn't match any known label
    const ctx = await enrich('hello world', providers, cache);

    expect(ctx.labels.length).toBe(0);
    expect(ctx.skills.length).toBe(0);
    expect(ctx.tools.length).toBe(0);
  });

  it('different prompts match different skills', async () => {
    const config = await loadConfig(root);
    const providers = await createProviders(config);
    const cache = await boot(providers);

    const tsCtx = await enrich('Fix TypeScript code', providers, cache);
    const reviewCtx = await enrich('Review this code for bugs', providers, cache);

    expect(tsCtx.skills.some(s => s.name === 'ts-standards')).toBe(true);
    expect(reviewCtx.skills.some(s => s.name === 'code-review')).toBe(true);
  });
});
