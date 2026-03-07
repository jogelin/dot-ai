/**
 * @dot-ai/ext-rules-routing — Rules-based model routing extension.
 */
import type { ExtensionAPI } from '@dot-ai/core';

interface RoutingRule {
  labels: string[];
  model: string;
  reason: string;
}

const DEFAULT_RULES: RoutingRule[] = [
  { labels: ['question', 'lookup', 'simple'], model: 'haiku', reason: 'simple query' },
  { labels: ['code-fix', 'implementation', 'feature'], model: 'sonnet', reason: 'standard development' },
  { labels: ['architecture', 'planning', 'complex', 'debug'], model: 'opus', reason: 'complex reasoning' },
];

export default function extRulesRouting(api: ExtensionAPI): void {
  const rules = DEFAULT_RULES;
  const fallback = 'sonnet';

  const allLabels = new Set<string>();
  for (const rule of rules) for (const l of rule.labels) allLabels.add(l);
  api.contributeLabels(Array.from(allLabels));

  api.on('route', async (event) => {
    const labelNames = new Set(event.labels.map((l: { name: string }) => l.name.toLowerCase()));
    for (const rule of rules) {
      if (rule.labels.some(rl => labelNames.has(rl.toLowerCase()))) {
        return { model: rule.model, reason: rule.reason };
      }
    }
    return { model: fallback, reason: 'default routing' };
  });
}
