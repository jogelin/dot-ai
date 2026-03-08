import type { Label } from './types.js';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract labels from a prompt using word-boundary keyword matching.
 * No LLM — pure deterministic pattern matching.
 * Returns matched Label[] from a known vocabulary.
 */
export function extractLabels(prompt: string, vocabulary: string[]): Label[] {
  const labels: Label[] = [];
  const seen = new Set<string>();

  // Skip very short labels (≤2 chars) — too many false positives (e.g. "og", "ha", "ai")
  const MIN_LABEL_LENGTH = 3;

  for (const word of vocabulary) {
    if (seen.has(word)) continue;
    if (word.length < MIN_LABEL_LENGTH) continue;
    const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'i');
    if (regex.test(prompt)) {
      seen.add(word);
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
