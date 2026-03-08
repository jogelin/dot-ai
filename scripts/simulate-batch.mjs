#!/usr/bin/env node
/**
 * Batch simulation of dot-ai use cases against the kiwi workspace.
 * Tests label extraction, skill matching, identity injection, and token efficiency.
 *
 * Usage: node scripts/simulate-batch.mjs [--verbose]
 */
import { DotAiRuntime, assembleSections } from '../packages/core/dist/index.js';

const verbose = process.argv.includes('--verbose');

const prompts = [
  // ═══════════════════════════════════════════════════════════════════════
  // 1. GREETINGS & CASUAL (minimal context expected)
  // ═══════════════════════════════════════════════════════════════════════
  { prompt: "salut ça va", expect: "no skill", cat: "casual" },
  { prompt: "bonjour", expect: "no skill", cat: "casual" },
  { prompt: "merci !", expect: "no skill", cat: "casual" },
  { prompt: "ok c'est bon", expect: "no skill", cat: "casual" },

  // ═══════════════════════════════════════════════════════════════════════
  // 2. USER / PERSONAL CONTEXT
  // ═══════════════════════════════════════════════════════════════════════
  { prompt: "c'est quoi mon timezone déjà ?", expect: "no skill, USER.md injected", cat: "user" },
  { prompt: "rappelle-moi mes préférences", expect: "no skill, USER.md injected", cat: "user" },  // needs v0.15 (FR labels)
  { prompt: "quel est mon fuseau horaire ?", expect: "no skill, USER.md injected", cat: "user" },  // needs v0.15 (FR labels)
  { prompt: "quel est mon nom ?", expect: "no skill", cat: "user" },  // semantic, can't regex-match

  // ═══════════════════════════════════════════════════════════════════════
  // 3. DOT-AI DEV
  // ═══════════════════════════════════════════════════════════════════════
  { prompt: "release dot-ai", expect: "dot-ai-dev", cat: "dot-ai" },
  { prompt: "améliorer le système dot-ai", expect: "dot-ai-dev", cat: "dot-ai" },
  { prompt: "simule l'injection du prompt", expect: "dot-ai-dev", cat: "dot-ai" },
  { prompt: "debug le context enrichment", expect: "dot-ai-dev", cat: "dot-ai" },

  // ═══════════════════════════════════════════════════════════════════════
  // 4. HOME ASSISTANT / IoT
  // ═══════════════════════════════════════════════════════════════════════
  { prompt: "allume la lumière du salon", expect: "ha-api", cat: "ha" },
  { prompt: "éteins la lumière du van", expect: "ha-api", cat: "ha" },
  { prompt: "check les logs de Home Assistant", expect: "ha-ssh", cat: "ha" },
  { prompt: "restart HA", expect: "ha-ssh", cat: "ha" },
  { prompt: "quelle est la température dans le van ?", expect: "ha-api", cat: "ha" },
  { prompt: "configure une automation pour le chauffage", expect: "ha-api", cat: "ha" },

  // ═══════════════════════════════════════════════════════════════════════
  // 5. COCKPIT / TASKS
  // ═══════════════════════════════════════════════════════════════════════
  { prompt: "montre les tâches du cockpit", expect: "cockpit-api", cat: "cockpit" },
  { prompt: "crée une tâche P1 pour le pipeline", expect: "cockpit-api", cat: "cockpit" },
  { prompt: "liste les biens dans le cockpit", expect: "cockpit-api", cat: "cockpit" },
  { prompt: "combien de POIs dans la base ?", expect: "cockpit-api", cat: "cockpit" },
  { prompt: "lance le digest", expect: "cockpit-api", cat: "cockpit" },

  // ═══════════════════════════════════════════════════════════════════════
  // 6. ROULE CAILLOU / PROPERTY
  // ═══════════════════════════════════════════════════════════════════════
  { prompt: "nouveaux biens immobiliers", expect: "property-search", cat: "property" },
  { prompt: "lance la veille", expect: "property-veille", cat: "property" },
  { prompt: "visite tera demain", expect: "tera-visits", cat: "property" },
  { prompt: "quel est le score de ce terrain ?", expect: "property-scoring", cat: "property" },
  { prompt: "exclus ce bien de la liste", expect: "property-exclude", cat: "property" },
  { prompt: "quels biens sont à proximité de Cantal ?", expect: "property-nearby", cat: "property" },
  { prompt: "fais le rapport des biens", expect: "property-report", cat: "property" },
  { prompt: "recherche bien sur LeBonCoin", expect: "property-search", cat: "property" },

  // ═══════════════════════════════════════════════════════════════════════
  // 7. POI MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════
  { prompt: "envoie les emails aux POIs", expect: "poi-outreach", cat: "poi" },
  { prompt: "synchronise le calendrier des POIs", expect: "poi-calendar-sync", cat: "poi" },
  { prompt: "ajoute un nouveau POI", expect: "poi-management", cat: "poi" },

  // ═══════════════════════════════════════════════════════════════════════
  // 8. WEB / SEO / PERFORMANCE
  // ═══════════════════════════════════════════════════════════════════════
  { prompt: "vérifie le SEO de la page", expect: "seo", cat: "web" },
  { prompt: "analyse les performances du site", expect: "performance", cat: "web" },
  { prompt: "lance un audit Lighthouse", expect: "core-web-vitals", cat: "web" },
  { prompt: "améliore le référencement de smartsdlc", expect: "seo", cat: "web" },

  // ═══════════════════════════════════════════════════════════════════════
  // 9. NX WORKSPACE
  // ═══════════════════════════════════════════════════════════════════════
  { prompt: "génère un nouveau composant nx", expect: "nx-generate", cat: "nx" },
  { prompt: "lance les tests nx", expect: "nx-run-tasks", cat: "nx" },
  { prompt: "montre le graph du workspace", expect: "nx-workspace", cat: "nx" },
  { prompt: "ajoute un plugin nx", expect: "nx-plugins", cat: "nx" },

  // ═══════════════════════════════════════════════════════════════════════
  // 10. PRO / BLOG / SOCIAL
  // ═══════════════════════════════════════════════════════════════════════
  { prompt: "écris un article de blog", expect: "write-blog-article", cat: "pro" },
  { prompt: "crée un post LinkedIn", expect: "social-post", cat: "pro" },
  { prompt: "publie sur les réseaux sociaux", expect: "social-post", cat: "pro" },
  { prompt: "prépare un article sur Nx Crystal", expect: "write-blog-article", cat: "pro" },

  // ═══════════════════════════════════════════════════════════════════════
  // 11. PIPELINE / CI
  // ═══════════════════════════════════════════════════════════════════════
  { prompt: "vérifie le pipeline CI", expect: "pipeline-ops", cat: "ci" },
  { prompt: "le build GitHub Actions est cassé", expect: "monitor-ci", cat: "ci" },
  { prompt: "crée un nouveau pipeline", expect: "pipeline-ops", cat: "ci" },

  // ═══════════════════════════════════════════════════════════════════════
  // 12. TOOLS / UTILITY
  // ═══════════════════════════════════════════════════════════════════════
  { prompt: "extrais le texte de ce PDF", expect: "mistral-ocr", cat: "tools" },
  { prompt: "les messages Discord n'arrivent pas", expect: "discord-delivery-debug", cat: "tools" },
  { prompt: "extrais les URLs de cette page", expect: "url-extractor", cat: "tools" },
  { prompt: "formate le rapport en markdown", expect: "report-formatter", cat: "tools" },

  // ═══════════════════════════════════════════════════════════════════════
  // 13. GOOGLE WORKSPACE
  // ═══════════════════════════════════════════════════════════════════════
  { prompt: "check mes emails", expect: "no skill", cat: "gws" },
  { prompt: "qu'est-ce que j'ai dans mon agenda demain ?", expect: "no skill", cat: "gws" },
  { prompt: "envoie un email via gmail", expect: "no skill", cat: "gws" },

  // ═══════════════════════════════════════════════════════════════════════
  // 14. VAN / ECOLE CAILLOU (project routing)
  // ═══════════════════════════════════════════════════════════════════════
  { prompt: "quelle est la checklist de départ du van ?", expect: "no skill", cat: "van" },
  { prompt: "programme de la semaine pour l'école", expect: "no skill", cat: "ecole" },

  // ═══════════════════════════════════════════════════════════════════════
  // 15. MULTI-INTENT / AMBIGUOUS
  // ═══════════════════════════════════════════════════════════════════════
  { prompt: "crée une tâche pour améliorer le SEO du blog", expect: "cockpit-api", cat: "multi" },
  { prompt: "vérifie le pipeline et corrige les tests", expect: "pipeline-ops", cat: "multi" },
  { prompt: "cherche un terrain et ajoute-le au cockpit", expect: "cockpit-api", cat: "multi" },

  // ═══════════════════════════════════════════════════════════════════════
  // 16. EDGE CASES
  // ═══════════════════════════════════════════════════════════════════════
  { prompt: "???", expect: "no skill", cat: "edge" },
  { prompt: "aide", expect: "no skill", cat: "edge" },
  { prompt: "qu'est-ce que tu sais faire ?", expect: "no skill", cat: "edge" },
];

const rt = new DotAiRuntime({ workspaceRoot: process.env.WORKSPACE ?? '/Users/jgelin/dev/kiwi' });
await rt.boot();

let pass = 0, fail = 0;
const catResults = {};

for (const { prompt, expect: expected, cat } of prompts) {
  const { sections, labels } = await rt.processPrompt(prompt);
  const skills = sections.filter(s => s.id?.startsWith('skill:')).map(s => s.id.replace('skill:', ''));
  const hasUser = sections.some(s => s.id === 'identity:user:root' && s.content.length > 50);
  const totalChars = sections.reduce((a, s) => a + s.content.length, 0);
  const tokens = Math.round(totalChars / 4);

  // Determine pass/fail
  const expectNoSkill = expected.startsWith('no skill');
  const expectUser = expected.includes('USER.md injected');
  const expectedSkillNames = expectNoSkill ? [] : expected.split(',').map(s => s.trim().split(' ')[0]);

  let ok = true;
  const issues = [];

  if (expectNoSkill && skills.length > 0) { ok = false; issues.push(`unexpected: ${skills.join(',')}`); }
  if (!expectNoSkill && skills.length === 0) { ok = false; issues.push('missing skill'); }
  if (!expectNoSkill && skills.length > 0) {
    // Check if at least one expected skill is in the results
    const hasExpected = expectedSkillNames.some(e => skills.some(s => s.includes(e)));
    if (!hasExpected) { ok = false; issues.push(`wrong skills: got [${skills.join(',')}] want [${expected}]`); }
  }
  if (expectUser && !hasUser) { ok = false; issues.push('USER.md should be full'); }

  if (ok) pass++; else fail++;
  if (!catResults[cat]) catResults[cat] = { pass: 0, fail: 0, total: 0 };
  catResults[cat].total++;
  if (ok) catResults[cat].pass++; else catResults[cat].fail++;

  const icon = ok ? '✅' : '❌';
  if (!ok || verbose) {
    console.log(`${icon} [${cat}] "${prompt}"`);
    console.log(`   Labels: [${labels.map(l => l.name).join(', ')}]`);
    console.log(`   Skills: [${skills.join(', ') || 'none'}] | USER: ${hasUser ? 'FULL' : 'ref'} | ~${tokens}t`);
    if (!ok) console.log(`   ⚠ ${issues.join(', ')}`);
    console.log(`   Expected: ${expected}`);
    console.log('');
  }
}

console.log(`${'═'.repeat(60)}`);
console.log(`RESULTS: ${pass}/${prompts.length} passed (${fail} failed)\n`);

console.log('By category:');
for (const [cat, r] of Object.entries(catResults).sort((a, b) => a[0].localeCompare(b[0]))) {
  const icon = r.fail === 0 ? '✅' : '❌';
  console.log(`  ${icon} ${cat.padEnd(12)} ${r.pass}/${r.total}`);
}

await rt.shutdown();
