import { describe, it, expect } from 'vitest';
import { RulesRoutingProvider } from '../../providers/rules-routing.js';
import type { Label } from '../../types.js';

function makeLabels(...names: string[]): Label[] {
  return names.map(name => ({ name, source: 'test' }));
}

describe('RulesRoutingProvider', () => {
  describe('route', () => {
    it('returns matching rule model for "question" label', async () => {
      const provider = new RulesRoutingProvider();
      const result = await provider.route(makeLabels('question'));
      expect(result.model).toBe('haiku');
      expect(result.reason).toBe('simple query');
    });

    it('returns matching rule model for "lookup" label', async () => {
      const provider = new RulesRoutingProvider();
      const result = await provider.route(makeLabels('lookup'));
      expect(result.model).toBe('haiku');
    });

    it('returns matching rule model for "simple" label', async () => {
      const provider = new RulesRoutingProvider();
      const result = await provider.route(makeLabels('simple'));
      expect(result.model).toBe('haiku');
    });

    it('returns sonnet for "implementation" label', async () => {
      const provider = new RulesRoutingProvider();
      const result = await provider.route(makeLabels('implementation'));
      expect(result.model).toBe('sonnet');
      expect(result.reason).toBe('standard development');
    });

    it('returns sonnet for "feature" label', async () => {
      const provider = new RulesRoutingProvider();
      const result = await provider.route(makeLabels('feature'));
      expect(result.model).toBe('sonnet');
    });

    it('returns sonnet for "code-fix" label', async () => {
      const provider = new RulesRoutingProvider();
      const result = await provider.route(makeLabels('code-fix'));
      expect(result.model).toBe('sonnet');
    });

    it('returns opus for "architecture" label', async () => {
      const provider = new RulesRoutingProvider();
      const result = await provider.route(makeLabels('architecture'));
      expect(result.model).toBe('opus');
      expect(result.reason).toBe('complex reasoning');
    });

    it('returns opus for "planning" label', async () => {
      const provider = new RulesRoutingProvider();
      const result = await provider.route(makeLabels('planning'));
      expect(result.model).toBe('opus');
    });

    it('returns opus for "complex" label', async () => {
      const provider = new RulesRoutingProvider();
      const result = await provider.route(makeLabels('complex'));
      expect(result.model).toBe('opus');
    });

    it('returns opus for "debug" label', async () => {
      const provider = new RulesRoutingProvider();
      const result = await provider.route(makeLabels('debug'));
      expect(result.model).toBe('opus');
    });

    it('returns default model when no label matches', async () => {
      const provider = new RulesRoutingProvider();
      const result = await provider.route(makeLabels('unrelated', 'nothing', 'noop'));
      expect(result.model).toBe('sonnet');
      expect(result.reason).toBe('default routing');
    });

    it('returns default model for empty labels', async () => {
      const provider = new RulesRoutingProvider();
      const result = await provider.route([]);
      expect(result.model).toBe('sonnet');
      expect(result.reason).toBe('default routing');
    });

    it('uses first matching rule (rules are evaluated in order)', async () => {
      const provider = new RulesRoutingProvider();
      // "question" matches first rule (haiku), "feature" matches second (sonnet)
      const result = await provider.route(makeLabels('question', 'feature'));
      expect(result.model).toBe('haiku'); // first rule wins
    });

    it('uses custom rules from options', async () => {
      const customRules = [
        { labels: ['my-label'], model: 'custom-model', reason: 'custom rule' },
      ];
      const provider = new RulesRoutingProvider({ rules: customRules });
      const result = await provider.route(makeLabels('my-label'));
      expect(result.model).toBe('custom-model');
      expect(result.reason).toBe('custom rule');
    });

    it('uses custom default model from options', async () => {
      const provider = new RulesRoutingProvider({ defaultModel: 'haiku' });
      const result = await provider.route(makeLabels('unmatched'));
      expect(result.model).toBe('haiku');
      expect(result.reason).toBe('default routing');
    });

    it('matching is case-insensitive', async () => {
      const provider = new RulesRoutingProvider();
      const result = await provider.route(makeLabels('QUESTION'));
      expect(result.model).toBe('haiku');
    });

    it('ignores optional context parameter', async () => {
      const provider = new RulesRoutingProvider();
      const result = await provider.route(makeLabels('question'), { someContext: true });
      expect(result.model).toBe('haiku');
    });
  });
});
