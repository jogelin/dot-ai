#!/usr/bin/env node
/**
 * Migrate file-based memory to SQLite.
 * Usage: npx tsx migrate-files.ts --root /path/to/workspace --db /path/to/memory.db
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SqliteMemoryProvider } from './index.js';

// Parse a single memory markdown file into entries
function parseMemoryFile(content: string, filename: string, node: string): Array<{
  content: string;
  type: string;
  date: string | undefined;
  labels: string[];
  node: string;
}> {
  // Extract date from filename if it matches YYYY-MM-DD pattern
  const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : undefined;

  // Split by ## headings into sections
  const sections = content.split(/^## /m).filter(Boolean);

  if (sections.length <= 1) {
    // Single entry — whole file is one memory
    return [{
      content: content.trim().slice(0, 2000),
      type: inferType(filename),
      date,
      labels: inferLabels(filename, content),
      node,
    }];
  }

  // Multiple sections — each ## heading becomes an entry
  return sections.map(section => {
    const lines = section.split('\n');
    const heading = lines[0]?.trim() ?? '';
    const body = lines.slice(1).join('\n').trim();
    const entryContent = heading ? `## ${heading}\n${body}` : body;

    return {
      content: entryContent.slice(0, 2000),
      type: inferType(filename),
      date,
      labels: inferLabels(filename, entryContent),
      node,
    };
  }).filter(e => e.content.length > 10);
}

function inferType(filename: string): string {
  if (filename.includes('lesson')) return 'lesson';
  if (filename.match(/^\d{4}-\d{2}-\d{2}/)) return 'log';
  if (filename.includes('research') || filename.includes('analysis')) return 'research';
  return 'note';
}

function inferLabels(filename: string, _content: string): string[] {
  const labels: string[] = [];
  const parts = filename.replace('.md', '').split('-');
  const meaningful = new Set(['cockpit', 'pro', 'roule', 'caillou', 'van', 'todo', 'home', 'assistant', 'dot', 'ai', 'nx', 'blog', 'property', 'poi', 'digest', 'email', 'api']);
  for (const part of parts) {
    if (meaningful.has(part.toLowerCase())) {
      labels.push(part.toLowerCase());
    }
  }
  return [...new Set(labels)];
}

async function scanMemoryDir(dir: string, node: string): Promise<Array<{ content: string; type: string; date?: string; labels: string[]; node: string }>> {
  const entries: Array<{ content: string; type: string; date?: string; labels: string[]; node: string }> = [];

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return entries;
  }

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    if (file === 'projects-index.md') continue;

    try {
      const content = await readFile(join(dir, file), 'utf-8');
      const parsed = parseMemoryFile(content, file, node);
      entries.push(...parsed);
    } catch {
      // Skip unreadable files
    }
  }

  // Also scan _archive/ subdirectory
  try {
    const archiveFiles = await readdir(join(dir, '_archive'));
    for (const file of archiveFiles) {
      if (!file.endsWith('.md')) continue;
      try {
        const content = await readFile(join(dir, '_archive', file), 'utf-8');
        const parsed = parseMemoryFile(content, file, node);
        entries.push(...parsed);
      } catch {
        // Skip
      }
    }
  } catch {
    // No archive dir
  }

  // Also scan lessons/ subdirectory
  try {
    const lessonFiles = await readdir(join(dir, 'lessons'));
    for (const file of lessonFiles) {
      if (!file.endsWith('.md')) continue;
      try {
        const content = await readFile(join(dir, 'lessons', file), 'utf-8');
        const parsed = parseMemoryFile(content, file, node);
        for (const entry of parsed) {
          entry.type = 'lesson';
        }
        entries.push(...parsed);
      } catch {
        // Skip
      }
    }
  } catch {
    // No lessons dir
  }

  return entries;
}

async function main() {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  const dbIdx = args.indexOf('--db');

  const root = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd();
  const dbPath = dbIdx >= 0 ? args[dbIdx + 1] : join(root, '.ai', 'memory.db');

  console.log(`Migrating memory files to SQLite`);
  console.log(`  Root: ${root}`);
  console.log(`  DB: ${dbPath}`);

  // Create provider (creates DB and tables)
  const provider = new SqliteMemoryProvider({ path: dbPath });

  // Scan root memory
  const rootEntries = await scanMemoryDir(join(root, '.ai', 'memory'), 'root');
  console.log(`  Root memory: ${rootEntries.length} entries`);

  // Scan project memories
  let projectEntries = 0;
  try {
    const projects = await readdir(join(root, 'projects'));
    for (const project of projects) {
      const memDir = join(root, 'projects', project, '.ai', 'memory');
      const entries = await scanMemoryDir(memDir, project);
      if (entries.length > 0) {
        console.log(`  ${project}: ${entries.length} entries`);
        for (const entry of entries) {
          await provider.store(entry);
        }
        projectEntries += entries.length;
      }
    }
  } catch {
    // No projects dir
  }

  // Store root entries
  for (const entry of rootEntries) {
    await provider.store(entry);
  }

  const total = rootEntries.length + projectEntries;
  console.log(`\nMigrated ${total} entries total`);

  // Test search
  console.log(`\nTest search for "cockpit":`);
  const results = await provider.search('cockpit');
  console.log(`  Found ${results.length} results`);
  if (results.length > 0) {
    console.log(`  First: ${results[0].content.slice(0, 100)}...`);
  }

  provider.close();
  console.log(`\nDone. DB saved to ${dbPath}`);
}

main().catch(console.error);
