#!/usr/bin/env node
import { DotAiRuntime, assembleSections } from '../packages/core/dist/index.js';

const prompts = [
  // 1. Simple greetings (should be minimal)
  { prompt: "salut ça va", expect: "no skills, no USER.md" },
  { prompt: "bonjour", expect: "no skills, no USER.md" },
  
  // 2. Personal/user context (no skill expected, just USER.md behavior)
  { prompt: "c'est quoi mon timezone déjà ?", expect: "no skill, USER.md injected" },
  { prompt: "rappelle-moi qui je suis", expect: "no skill, semantic - acceptable as ref" },
  
  // 3. dot-ai dev
  { prompt: "release dot-ai", expect: "dot-ai-dev skill" },
  { prompt: "améliorer le système dot-ai", expect: "dot-ai-dev skill" },
  { prompt: "simule l'injection du prompt", expect: "dot-ai-dev skill" },
  
  // 4. Home Assistant
  { prompt: "allume la lumière du salon", expect: "ha-api skill" },
  { prompt: "check les logs de Home Assistant", expect: "ha-ssh skill" },
  { prompt: "restart HA", expect: "ha-ssh skill" },
  
  // 5. Cockpit/Tasks
  { prompt: "montre les tâches du cockpit", expect: "cockpit-api skill" },
  { prompt: "crée une tâche P1 pour le pipeline", expect: "cockpit-api skill" },
  
  // 6. Roule Caillou / Property
  { prompt: "nouveaux biens immobiliers", expect: "property-search skill" },
  { prompt: "lance la veille", expect: "property-veille skill" },
  { prompt: "visite tera demain", expect: "tera-visits skill" },
  
  // 7. Web/SEO/Performance (now auto)
  { prompt: "vérifie le SEO de la page", expect: "seo skill" },
  { prompt: "analyse les performances du site", expect: "performance skill" },
  
  // 8. Nx workspace
  { prompt: "génère un nouveau composant nx", expect: "nx-generate skill" },
  { prompt: "lance les tests nx", expect: "nx-run-tasks skill" },
  
  // 9. Pro/Blog
  { prompt: "écris un article de blog", expect: "write-blog-article or write-article" },
  { prompt: "crée un post LinkedIn", expect: "social-post skill" },
  
  // 10. POI management
  { prompt: "envoie les emails aux POIs", expect: "poi-outreach skill" },
  { prompt: "synchronise le calendrier des POIs", expect: "poi-calendar-sync skill" },
  
  // 11. Pipeline/CI
  { prompt: "vérifie le pipeline CI", expect: "monitor-ci or pipeline-ops" },
  
  // 12. OCR
  { prompt: "extrais le texte de ce PDF", expect: "mistral-ocr skill" },
  
  // 13. Discord debug
  { prompt: "les messages Discord n'arrivent pas", expect: "discord-delivery-debug" },
];

const rt = new DotAiRuntime({ workspaceRoot: process.env.WORKSPACE ?? '/Users/jgelin/dev/kiwi' });
await rt.boot();

let pass = 0, fail = 0;

for (const { prompt, expect: expected } of prompts) {
  const { sections, labels } = await rt.processPrompt(prompt);
  const skills = sections.filter(s => s.id?.startsWith('skill:')).map(s => s.id.replace('skill:', ''));
  const hasUser = sections.some(s => s.id === 'identity:user:root' && s.content.length > 50);
  const totalChars = sections.reduce((a, s) => a + s.content.length, 0);
  const tokens = Math.round(totalChars / 4);

  // Determine pass/fail
  const expectNoSkill = expected.includes('no skill') || expected.includes('manual');
  const expectSkill = !expectNoSkill;
  const expectUser = expected.includes('USER.md injected');
  
  let ok = true;
  const issues = [];
  
  if (expectSkill && skills.length === 0) { ok = false; issues.push('missing skill'); }
  if (expectNoSkill && skills.length > 0) { ok = false; issues.push(`unexpected skill: ${skills.join(',')}`); }
  if (expectUser && !hasUser) { ok = false; issues.push('USER.md should be full'); }
  if (!expectUser && hasUser) { issues.push('USER.md injected unnecessarily'); }
  
  const icon = ok ? '✅' : '❌';
  if (ok) pass++; else fail++;

  console.log(`${icon} "${prompt}"`);
  console.log(`   Labels: [${labels.map(l => l.name).join(', ')}]`);
  console.log(`   Skills: [${skills.join(', ') || 'none'}] | USER: ${hasUser ? 'FULL' : 'ref'} | ~${tokens}t`);
  if (!ok) console.log(`   ⚠ ISSUES: ${issues.join(', ')}`);
  console.log(`   Expected: ${expected}`);
  console.log('');
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`Results: ${pass} passed, ${fail} failed out of ${prompts.length}`);

await rt.shutdown();
