#!/usr/bin/env node
import { argv, cwd, exit } from 'node:process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  loadConfig,
  resolveConfig,
  injectRoot,
  registerDefaults,
  clearProviders,
  createProviders,
  boot,
  enrich,
  formatContext,
} from '@dot-ai/core';

const args = argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case 'init':
      await cmdInit();
      break;
    case 'boot':
      await cmdBoot();
      break;
    case 'trace':
      await cmdTrace(args.slice(1));
      break;
    default:
      console.log('dot-ai v0.4.0\n');
      console.log('Commands:');
      console.log('  init              Create .ai/ directory with defaults');
      console.log('  boot              Run boot and show workspace info');
      console.log('  trace "<prompt>"  Dry-run enrich pipeline with token estimates');
      exit(command ? 1 : 0);
  }
}

async function cmdInit(): Promise<void> {
  const root = cwd();
  const aiDir = join(root, '.ai');

  try {
    await access(join(aiDir, 'dot-ai.yml'));
    console.log('.ai/dot-ai.yml already exists. Nothing to do.');
    return;
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

  console.log('Created:');
  console.log('  .ai/dot-ai.yml    (config)');
  console.log('  .ai/AGENTS.md     (template)');
  console.log('\nNext: add SOUL.md, USER.md, skills/, memory/ as needed.');
}

async function cmdBoot(): Promise<void> {
  const root = cwd();
  const start = performance.now();

  clearProviders();
  registerDefaults();

  const rawConfig = await loadConfig(root);
  const config = injectRoot(rawConfig, root);
  const providers = await createProviders(config);
  const cache = await boot(providers);

  const duration = Math.round(performance.now() - start);

  console.log(`dot-ai boot — ${root}\n`);
  console.log(`Identities: ${cache.identities.length}${cache.identities.length > 0 ? ` (${cache.identities.map(i => i.type).join(', ')})` : ''}`);
  console.log(`Skills: ${cache.skills.length}${cache.skills.length > 0 ? ` (${cache.skills.map(s => s.name).join(', ')})` : ''}`);
  console.log(`Vocabulary: ${cache.vocabulary.length} labels`);
  console.log(`\nBoot complete in ${duration}ms`);
}

async function cmdTrace(rawArgs: string[]): Promise<void> {
  const flags = new Set(rawArgs.filter(a => a.startsWith('--')));
  const prompt = rawArgs.filter(a => !a.startsWith('--')).join(' ');
  const jsonMode = flags.has('--json');
  const verbose = flags.has('--verbose');

  if (!prompt) {
    console.error('Usage: dot-ai trace "<prompt>" [--json] [--verbose]');
    exit(1);
  }

  const root = cwd();
  const start = performance.now();

  clearProviders();
  registerDefaults();

  const rawConfig = await loadConfig(root);
  const config = injectRoot(rawConfig, root);
  const resolved = resolveConfig(rawConfig);
  const providers = await createProviders(config);
  const cache = await boot(providers);
  const ctx = await enrich(prompt, providers, cache);

  // Load skill content for matched skills
  for (const skill of ctx.skills) {
    if (!skill.content && skill.name) {
      skill.content = await providers.skills.load(skill.name) ?? undefined;
    }
  }

  const duration = Math.round(performance.now() - start);

  // Compute token estimates
  const identityChars = cache.identities.reduce((sum, i) => sum + (i.content?.length ?? 0), 0);
  const skillChars = ctx.skills.reduce((sum, s) => sum + (s.content?.length ?? 0), 0);
  const memoryChars = ctx.memories.reduce((sum, m) => sum + m.content.length, 0);
  const totalChars = skillChars + memoryChars;

  // Check for disabled skills
  const disabledList = typeof resolved.skills?.with?.disabled === 'string'
    ? resolved.skills.with.disabled.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];

  if (jsonMode) {
    const output = {
      prompt,
      sessionStart: {
        identityCount: cache.identities.length,
        identityChars,
        estimatedTokens: Math.round(identityChars / 4),
      },
      userPromptSubmit: {
        labels: ctx.labels.map(l => l.name),
        skills: ctx.skills.map(s => ({
          name: s.name,
          chars: s.content?.length ?? 0,
        })),
        memoryCount: ctx.memories.length,
        memoryChars,
        toolCount: ctx.tools.length,
        routing: ctx.routing,
        totalChars,
        estimatedTokens: Math.round(totalChars / 4),
      },
      disabled: disabledList,
      vocabularySize: cache.vocabulary.length,
      durationMs: duration,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Human-readable output
  console.log(`dot-ai trace — "${prompt}"\n`);

  // SessionStart section
  console.log(`── SessionStart (one-time) ──`);
  console.log(`  ${cache.identities.length} identities: ${identityChars.toLocaleString()} chars (~${Math.round(identityChars / 4).toLocaleString()} tokens)`);

  // UserPromptSubmit section
  console.log(`\n── UserPromptSubmit ──`);
  console.log(`  Labels: [${ctx.labels.map(l => l.name).join(', ')}]`);

  if (ctx.skills.length > 0) {
    const skillDetails = ctx.skills.map(s => `${s.name} (${(s.content?.length ?? 0).toLocaleString()} chars)`);
    console.log(`  Skills: ${skillDetails.join(', ')}`);
  } else {
    console.log(`  Skills: none matched`);
  }

  console.log(`  Memory: ${ctx.memories.length} entries (${memoryChars.toLocaleString()} chars)`);
  console.log(`  Tools: ${ctx.tools.length} matched`);
  console.log(`  Routing: ${ctx.routing.model} (${ctx.routing.reason})`);
  console.log(`  Total: ${totalChars.toLocaleString()} chars (~${Math.round(totalChars / 4).toLocaleString()} tokens)`);

  // Disabled skills
  if (disabledList.length > 0) {
    console.log(`\n── Disabled skills ──`);
    console.log(`  ${disabledList.join(', ')} (via config)`);
  }

  // Verbose: show the actual markdown that would be injected
  if (verbose) {
    const formatted = formatContext(ctx, {
      skipIdentities: true,
      maxSkillLength: 3000,
      maxSkills: 5,
    });
    console.log(`\n── Injected markdown (${formatted.length.toLocaleString()} chars) ──`);
    console.log(formatted);
  }

  console.log(`\nTrace complete in ${duration}ms`);
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
