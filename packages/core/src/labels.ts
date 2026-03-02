import type { Label } from './types.js';

/**
 * Extract labels from a prompt using simple keyword matching.
 * No LLM — pure deterministic pattern matching.
 * Returns matched Label[] from a known vocabulary.
 */
export function extractLabels(prompt: string, vocabulary: string[]): Label[] {
  const lower = prompt.toLowerCase();
  const labels: Label[] = [];

  for (const word of vocabulary) {
    if (lower.includes(word.toLowerCase())) {
      labels.push({ name: word, source: 'extract' });
    }
  }

  return labels;
}

/**
 * Build a vocabulary from skill labels and any other known labels.
 * This is called once at boot to build the label dictionary.
 */
export function buildVocabulary(skillLabels: string[][], toolLabels: string[][]): string[] {
  const set = new Set<string>();
  for (const labels of [...skillLabels, ...toolLabels]) {
    for (const label of labels) {
      set.add(label);
    }
  }
  return Array.from(set);
}
