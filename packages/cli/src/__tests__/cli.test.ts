import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── init command logic ───────────────────────────────────────────────────────

async function runInit(root: string): Promise<string> {
  const aiDir = join(root, '.ai');
  const lines: string[] = [];

  try {
    await access(join(aiDir, 'settings.json'));
    lines.push('.ai/settings.json already exists. Nothing to do.');
    return lines.join('\n');
  } catch {
    // Doesn't exist, create it
  }

  await mkdir(aiDir, { recursive: true });

  await writeFile(join(aiDir, 'settings.json'), JSON.stringify({
    extensions: [],
    packages: [],
  }, null, 2));

  await writeFile(join(aiDir, 'AGENTS.md'), [
    '# AGENTS.md',
    '',
    '> Your workspace rules and conventions go here.',
    '',
    '## Rules',
    '',
    '- ...',
    '',
  ].join('\n'));

  lines.push('Created:');
  lines.push('  .ai/settings.json (config)');
  lines.push('  .ai/AGENTS.md     (template)');
  lines.push('\nNext: add extensions to .ai/extensions/ or settings.json as needed.');
  return lines.join('\n');
}

// ── init tests ───────────────────────────────────────────────────────────────

describe('init command', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dot-ai-cli-init-'));
  });

  it('creates .ai/settings.json in empty directory', async () => {
    await runInit(root);
    const content = await readFile(join(root, '.ai', 'settings.json'), 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.extensions).toEqual([]);
    expect(parsed.packages).toEqual([]);
  });

  it('creates .ai/AGENTS.md in empty directory', async () => {
    await runInit(root);
    const content = await readFile(join(root, '.ai', 'AGENTS.md'), 'utf8');
    expect(content).toContain('# AGENTS.md');
  });

  it('AGENTS.md is a template with ## Rules section', async () => {
    await runInit(root);
    const content = await readFile(join(root, '.ai', 'AGENTS.md'), 'utf8');
    expect(content).toContain('## Rules');
  });

  it('does nothing if settings.json already exists', async () => {
    await mkdir(join(root, '.ai'), { recursive: true });
    await writeFile(join(root, '.ai', 'settings.json'), '{"existing": true}\n');

    const output = await runInit(root);

    expect(output).toContain('already exists');
    const content = await readFile(join(root, '.ai', 'settings.json'), 'utf8');
    expect(content).toBe('{"existing": true}\n');
  });

  it('works if .ai/ directory already exists without settings.json', async () => {
    await mkdir(join(root, '.ai'), { recursive: true });
    await writeFile(join(root, '.ai', 'AGENTS.md'), '# existing\n');

    await runInit(root);

    const content = await readFile(join(root, '.ai', 'settings.json'), 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.extensions).toEqual([]);
  });
});
