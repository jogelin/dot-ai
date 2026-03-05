#!/usr/bin/env node
/**
 * dot-ai-sync — sync enriched context to agent config files.
 *
 * Usage:
 *   dot-ai-sync .cursorrules              # Sync to Cursor
 *   dot-ai-sync .github/copilot-instructions.md  # Sync to Copilot
 *   dot-ai-sync --unsync .cursorrules     # Remove dot-ai content
 */
import { argv, cwd, exit } from 'node:process';
import { join } from 'node:path';
import {
  loadConfig,
  injectRoot,
  registerDefaults,
  clearProviders,
  createProviders,
  boot,
  enrich,
} from '@dot-ai/core';
import { syncToFile, unsyncFromFile } from './sync.js';

const args = argv.slice(2);

async function main(): Promise<void> {
  if (args.length === 0) {
    console.log('Usage: dot-ai-sync <target-file> [--unsync]');
    console.log('\nExamples:');
    console.log('  dot-ai-sync .cursorrules');
    console.log('  dot-ai-sync .github/copilot-instructions.md');
    console.log('  dot-ai-sync --unsync .cursorrules');
    exit(0);
  }

  const unsync = args.includes('--unsync');
  const targetFile = args.find(a => !a.startsWith('--'));

  if (!targetFile) {
    console.error('Error: specify a target file');
    exit(1);
  }

  const root = cwd();
  const targetPath = join(root, targetFile);

  if (unsync) {
    await unsyncFromFile(targetPath);
    console.log(`Removed dot-ai content from ${targetFile}`);
    return;
  }

  clearProviders();
  registerDefaults();

  const rawConfig = await loadConfig(root);
  const config = injectRoot(rawConfig, root);
  const providers = await createProviders(config);
  const cache = await boot(providers);

  // For sync, we enrich with an empty prompt (just boot context)
  const ctx = await enrich('', providers, cache);

  // Load skill content
  if (providers.skills) {
    for (const skill of ctx.skills) {
      if (!skill.content && skill.name) {
        skill.content = await providers.skills.load(skill.name) ?? undefined;
      }
    }
  }

  await syncToFile(targetPath, ctx);
  console.log(`Synced dot-ai context to ${targetFile}`);
  console.log(`  Identities: ${ctx.identities.length}`);
  console.log(`  Skills: ${ctx.skills.length}`);
  console.log(`  Tools: ${ctx.tools.length}`);
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
