#!/usr/bin/env node
/**
 * Simulate dot-ai context injection for a given prompt.
 * Usage: node scripts/simulate-prompt.mjs "salut ça va"
 * 
 * Runs the real DotAiRuntime against the kiwi workspace,
 * outputs what would be injected.
 */
import { DotAiRuntime, assembleSections } from '../packages/core/dist/index.js';

const prompt = process.argv[2] ?? 'hello';
const workspaceRoot = process.env.WORKSPACE ?? '/Users/jgelin/dev/kiwi';

const runtime = new DotAiRuntime({ workspaceRoot });
await runtime.boot();

const { sections, labels, routing } = await runtime.processPrompt(prompt);

// Split like the adapter does
const staticSections = sections.filter(s => s.trimStrategy === 'never');
const dynamicSections = sections.filter(s => s.trimStrategy !== 'never');

console.log(`\n🔍 Prompt: "${prompt}"`);
console.log(`📊 Labels: [${labels.map(l => l.name).join(', ')}]`);
console.log(`🔀 Routing: ${routing?.model ?? 'default'}`);
console.log(`\n📋 Sections (${sections.length} total):`);

let totalChars = 0;
for (const s of sections) {
  const zone = s.trimStrategy === 'never' ? 'static' : 'dynamic';
  console.log(`  [${zone}] ${s.id ?? '?'} — ${s.content.length} chars (prio=${s.priority})`);
  totalChars += s.content.length;
}

console.log(`\n📏 Total: ${totalChars} chars (~${Math.round(totalChars/4)} tokens)`);
console.log(`   Static: ${staticSections.reduce((a,s) => a + s.content.length, 0)} chars`);
console.log(`   Dynamic: ${dynamicSections.reduce((a,s) => a + s.content.length, 0)} chars`);

// Show content preview
if (process.argv.includes('--full')) {
  console.log('\n' + '='.repeat(60));
  console.log('STATIC (prependSystemContext):');
  console.log('='.repeat(60));
  console.log(assembleSections(staticSections));
  console.log('\n' + '='.repeat(60));
  console.log('DYNAMIC (prependContext):');
  console.log('='.repeat(60));
  console.log(assembleSections(dynamicSections));
}

await runtime.shutdown();
