import { readFile, writeFile } from 'node:fs/promises';
import type { Capability, Section } from '@dot-ai/core';
import { DotAiRuntime, formatSections, formatToolHints } from '@dot-ai/core';

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
  sections: Section[],
  capabilities?: Capability[],
): Promise<void> {
  let formatted = formatSections(sections);

  // Append tool hints from extension capabilities
  if (capabilities && capabilities.length > 0) {
    const hints = formatToolHints(capabilities);
    if (hints) {
      formatted += '\n\n---\n\n' + hints;
    }
  }

  const block = `${START_MARKER}\n${formatted}\n${END_MARKER}`;
  await writeBlock(targetPath, block);
}

async function writeBlock(targetPath: string, block: string): Promise<void> {
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
 * Sync workspace context to a target file using DotAiRuntime.
 * Boots the runtime, processes an empty prompt to get full context,
 * and writes the result with markers.
 */
export async function syncWorkspace(
  workspaceRoot: string,
  targetPath: string,
  prompt = '',
): Promise<void> {
  const runtime = new DotAiRuntime({ workspaceRoot });
  await runtime.boot();
  const result = await runtime.processPrompt(prompt);
  const formatted = formatSections(result.sections);
  await syncFormatted(targetPath, formatted, runtime.capabilities);
  await runtime.flush();
}

/**
 * Sync a pre-formatted string to a target file using markers.
 */
export async function syncFormatted(
  targetPath: string,
  formatted: string,
  capabilities?: Capability[],
): Promise<void> {
  let content = formatted;

  if (capabilities && capabilities.length > 0) {
    const hints = formatToolHints(capabilities);
    if (hints) {
      content += '\n\n---\n\n' + hints;
    }
  }

  const block = `${START_MARKER}\n${content}\n${END_MARKER}`;
  await writeBlock(targetPath, block);
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
