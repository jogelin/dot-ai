import { readFile, writeFile } from 'node:fs/promises';
import type { EnrichedContext } from '@dot-ai/core';
import { formatContext } from './format.js';

const START_MARKER = '<!-- dot-ai:start -->';
const END_MARKER = '<!-- dot-ai:end -->';

/**
 * Sync enriched context to a target file using markers.
 * Preserves content outside the markers.
 *
 * If the file doesn't exist, creates it with the markers.
 * If the file exists but has no markers, appends them at the end.
 * If the file has markers, replaces content between them.
 */
export async function syncToFile(
  targetPath: string,
  ctx: EnrichedContext,
): Promise<void> {
  const formatted = formatContext(ctx);
  const block = `${START_MARKER}\n${formatted}\n${END_MARKER}`;

  let existing: string;
  try {
    existing = await readFile(targetPath, 'utf-8');
  } catch {
    // File doesn't exist — create with markers
    await writeFile(targetPath, block + '\n', 'utf-8');
    return;
  }

  // File exists — check for markers
  const startIdx = existing.indexOf(START_MARKER);
  const endIdx = existing.indexOf(END_MARKER);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace content between markers
    const before = existing.substring(0, startIdx);
    const after = existing.substring(endIdx + END_MARKER.length);
    await writeFile(targetPath, before + block + after, 'utf-8');
  } else {
    // No markers — append
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    await writeFile(targetPath, existing + separator + block + '\n', 'utf-8');
  }
}

/**
 * Remove dot-ai content from a target file.
 */
export async function unsyncFromFile(targetPath: string): Promise<void> {
  let content: string;
  try {
    content = await readFile(targetPath, 'utf-8');
  } catch {
    return; // File doesn't exist
  }

  const startIdx = content.indexOf(START_MARKER);
  const endIdx = content.indexOf(END_MARKER);

  if (startIdx !== -1 && endIdx !== -1) {
    const before = content.substring(0, startIdx);
    const after = content.substring(endIdx + END_MARKER.length);
    const cleaned = (before + after).replace(/\n{3,}/g, '\n\n').trim();
    await writeFile(targetPath, cleaned + '\n', 'utf-8');
  }
}
