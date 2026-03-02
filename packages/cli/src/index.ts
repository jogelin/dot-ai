#!/usr/bin/env node
import { argv, cwd, exit } from 'node:process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  loadConfig,
  registerDefaults,
  clearProviders,
  createProviders,
  boot,
  enrich,
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
      await cmdTrace(args.slice(1).join(' '));
      break;
    default:
      console.log('dot-ai v0.4.0\n');
      console.log('Commands:');
      console.log('  init              Create .ai/ directory with defaults');
      console.log('  boot              Run boot and show workspace info');
      console.log('  trace "<prompt>"  Dry-run enrich pipeline');
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
    '#   use: "@dot-ai/file-memory"',
    '#',
    '# skills:',
    '#   use: "@dot-ai/file-skills"',
    '#',
    '# routing:',
    '#   use: "@dot-ai/rules-routing"',
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

  const config = await loadConfig(root);
  const providers = await createProviders(config);
  const cache = await boot(providers);

  const duration = Math.round(performance.now() - start);

  console.log(`dot-ai boot — ${root}\n`);
  console.log(`Identities: ${cache.identities.length}${cache.identities.length > 0 ? ` (${cache.identities.map(i => i.type).join(', ')})` : ''}`);
  console.log(`Skills: ${cache.skills.length}${cache.skills.length > 0 ? ` (${cache.skills.map(s => s.name).join(', ')})` : ''}`);
  console.log(`Vocabulary: ${cache.vocabulary.length} labels`);
  console.log(`\nBoot complete in ${duration}ms`);
}

async function cmdTrace(prompt: string): Promise<void> {
  if (!prompt) {
    console.error('Usage: dot-ai trace "<prompt>"');
    exit(1);
  }

  const root = cwd();
  const start = performance.now();

  clearProviders();
  registerDefaults();

  const config = await loadConfig(root);
  const providers = await createProviders(config);
  const cache = await boot(providers);
  const ctx = await enrich(prompt, providers, cache);

  const duration = Math.round(performance.now() - start);

  console.log(`dot-ai trace — "${prompt}"\n`);

  // Labels
  console.log(`Labels: [${ctx.labels.map(l => l.name).join(', ')}]`);

  // Memories
  console.log(`Memories: ${ctx.memories.length} found`);
  for (const m of ctx.memories.slice(0, 5)) {
    const date = m.date ? ` (${m.date})` : '';
    console.log(`  - ${m.content}${date}`);
  }
  if (ctx.memories.length > 5) console.log(`  ... and ${ctx.memories.length - 5} more`);

  // Skills
  console.log(`Skills: ${ctx.skills.length} matched`);
  for (const s of ctx.skills) {
    console.log(`  - ${s.name}`);
  }

  // Tools
  console.log(`Tools: ${ctx.tools.length} matched`);
  for (const t of ctx.tools) {
    console.log(`  - ${t.name}: ${t.description}`);
  }

  // Routing
  console.log(`Routing: ${ctx.routing.model} (${ctx.routing.reason})`);

  console.log(`\nTrace complete in ${duration}ms`);
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
