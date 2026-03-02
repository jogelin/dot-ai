import type { RoutingProvider } from '../contracts.js';
import type { Label, RoutingResult } from '../types.js';

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

export class RulesRoutingProvider implements RoutingProvider {
  private rules: RoutingRule[];
  private defaultModel: string;

  constructor(options: Record<string, unknown> = {}) {
    this.rules = (options.rules as RoutingRule[]) ?? DEFAULT_RULES;
    this.defaultModel = (options.defaultModel as string) ?? 'sonnet';
  }

  async route(labels: Label[], _context?: Record<string, unknown>): Promise<RoutingResult> {
    const labelNames = new Set(labels.map(l => l.name.toLowerCase()));

    for (const rule of this.rules) {
      if (rule.labels.some(rl => labelNames.has(rl.toLowerCase()))) {
        return { model: rule.model, reason: rule.reason };
      }
    }

    return { model: this.defaultModel, reason: 'default routing' };
  }
}
