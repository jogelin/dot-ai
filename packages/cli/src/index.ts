#!/usr/bin/env node
import { argv, cwd, exit } from 'node:process';
import { createRequire } from 'node:module';
import { mkdir, writeFile, access, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  DotAiRuntime,
  clearBootCache,
  formatSections,
} from '@dot-ai/core';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json') as { version: string };

const args = argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case 'init':
      await cmdInit();
      break;
    case 'boot':
      await cmdBoot();
      break;
    case 'trace':
      await cmdTrace(args.slice(1));
      break;
    case 'cache':
      await cmdCache(args.slice(1));
      break;
    case 'tools':
      await cmdTools(args.slice(1));
      break;
    case 'commands':
      await cmdCommands();
      break;
    case 'migrate':
      await cmdMigrate();
      break;
    case '--version':
    case '-v':
      console.log(`dot-ai v${PKG_VERSION}`);
      break;
    default:
      // Try to execute as a tool: dot-ai <domain> <action> [args...]
      if (command && !command.startsWith('-')) {
        await cmdExecTool(args);
      } else {
        printHelp();
        exit(command ? 1 : 0);
      }
  }
}

function printHelp(): void {
  console.log(`dot-ai v${PKG_VERSION}\n`);
  console.log('Commands:');
  console.log('  init                          Create .ai/ directory with defaults');
  console.log('  boot                          Run boot and show workspace info');
  console.log('  trace "<prompt>"              Dry-run enrich pipeline with token estimates');
  console.log('  tools [--json]                List registered tools from extensions');
  console.log('  commands                      List registered commands from extensions');
  console.log('  cache clear                   Clear boot cache');
  console.log('  cache status                  Show cache status');
  console.log('  migrate                       Migrate dot-ai.yml to settings.json');
  console.log('');
  console.log('Tool execution:');
  console.log('  dot-ai <domain> <action> [args...]');
  console.log('  dot-ai memory recall "query"  Execute memory_recall tool');
  console.log('  dot-ai tasks list             Execute task_list tool');
  console.log('');
  console.log('Flags:');
  console.log('  --json                        Output as JSON');
  console.log('  --workspace <path>            Override workspace root');
}

// ── Workspace Detection ──

async function resolveWorkspace(): Promise<string> {
  const wsIdx = args.indexOf('--workspace');
  if (wsIdx !== -1 && args[wsIdx + 1]) {
    return resolve(args[wsIdx + 1]);
  }

  let dir = cwd();
  const root = resolve('/');

  while (dir !== root) {
    try {
      await access(join(dir, '.ai'));
      return dir;
    } catch {
      dir = resolve(dir, '..');
    }
  }

  return cwd();
}

// ── Boot Runtime ──

async function bootRuntime(workspaceRoot?: string): Promise<DotAiRuntime> {
  const ws = workspaceRoot ?? await resolveWorkspace();
  const runtime = new DotAiRuntime({ workspaceRoot: ws });
  await runtime.boot();
  return runtime;
}

// ── Tool Execution ──

async function cmdExecTool(rawArgs: string[]): Promise<void> {
  const jsonMode = rawArgs.includes('--json');
  const cleanArgs = rawArgs.filter(a => a !== '--json' && a !== '--workspace').filter((_, i, arr) => {
    if (i > 0 && arr[i - 1] === '--workspace') return false;
    return true;
  });

  const domain = cleanArgs[0];
  const action = cleanArgs[1];

  if (!domain || !action) {
    console.error(`Unknown command: ${domain ?? ''}`);
    console.error('Run "dot-ai" for help.');
    exit(1);
  }

  const toolName = `${domain}_${action}`;
  const toolArgs = cleanArgs.slice(2);

  const runtime = await bootRuntime();
  const tools = runtime.capabilities;

  const tool = tools.find(t => t.name === toolName);
  if (!tool) {
    console.error(`Unknown tool: ${toolName}`);
    console.error('Available tools:');
    for (const t of tools) {
      console.error(`  ${t.name} — ${t.description}`);
    }
    exit(1);
  }

  const input = parseToolArgs(toolArgs, tool.parameters);

  try {
    const result = await tool.execute(input);
    if (jsonMode) {
      console.log(JSON.stringify({ content: result.text, details: result.details }, null, 2));
    } else {
      console.log(result.text);
    }
  } catch (err) {
    console.error(`Tool execution error: ${err instanceof Error ? err.message : err}`);
    exit(1);
  } finally {
    await runtime.flush();
  }
}

function parseToolArgs(rawArgs: string[], schema: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const props = (schema as { properties?: Record<string, { type?: string }> }).properties ?? {};
  const required = (schema as { required?: string[] }).required ?? [];
  const propNames = Object.keys(props);

  let positionalIdx = 0;
  let i = 0;

  while (i < rawArgs.length) {
    const arg = rawArgs[i];

    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        input[key] = coerceValue(value, props[key]?.type);
      } else {
        const key = arg.slice(2);
        const nextArg = rawArgs[i + 1];
        if (nextArg && !nextArg.startsWith('--')) {
          input[key] = coerceValue(nextArg, props[key]?.type);
          i++;
        } else {
          input[key] = true;
        }
      }
    } else {
      const targetKey = required[positionalIdx] ?? propNames.find(p => !(p in input));
      if (targetKey) {
        input[targetKey] = coerceValue(arg, props[targetKey]?.type);
      }
      positionalIdx++;
    }
    i++;
  }

  return input;
}

function coerceValue(value: string, type?: string): unknown {
  if (type === 'number') return Number(value);
  if (type === 'boolean') return value === 'true';
  if (type === 'array') {
    try { return JSON.parse(value); } catch { return value.split(','); }
  }
  return value;
}

// ── Tools List ──

async function cmdTools(rawArgs: string[]): Promise<void> {
  const jsonMode = rawArgs.includes('--json');
  const runtime = await bootRuntime();
  const tools = runtime.capabilities;

  if (jsonMode) {
    const output = tools.map(t => ({
      name: t.name,
      description: t.description,
      category: t.category,
      readOnly: t.readOnly,
    }));
    console.log(JSON.stringify(output, null, 2));
  } else {
    if (tools.length === 0) {
      console.log('No tools registered.');
    } else {
      console.log(`${tools.length} tool(s) registered:\n`);
      for (const t of tools) {
        const cat = t.category ? ` [${t.category}]` : '';
        const ro = t.readOnly ? ' (read-only)' : '';
        console.log(`  ${t.name}${cat}${ro}`);
        console.log(`    ${t.description}`);
      }
    }
  }

  await runtime.flush();
}

// ── Commands List ──

async function cmdCommands(): Promise<void> {
  const runtime = await bootRuntime();
  const runner = runtime.runner;
  const commands = runner?.commands ?? [];

  if (commands.length === 0) {
    console.log('No commands registered.');
  } else {
    console.log(`${commands.length} command(s) registered:\n`);
    for (const cmd of commands) {
      const params = cmd.parameters?.map((p: { name: string; required?: boolean }) =>
        p.required ? `<${p.name}>` : `[${p.name}]`
      ).join(' ') ?? '';
      console.log(`  /${cmd.name} ${params}`);
      console.log(`    ${cmd.description}`);
    }
  }

  await runtime.flush();
}

// ── Cache Management ──

async function cmdCache(rawArgs: string[]): Promise<void> {
  const subcommand = rawArgs[0];
  const ws = await resolveWorkspace();
  const cacheDir = join(ws, '.ai', '.cache');

  switch (subcommand) {
    case 'clear': {
      await clearBootCache(ws);
      console.log('Cache cleared.');
      break;
    }
    case 'status': {
      try {
        const bootJson = join(cacheDir, 'boot.json');
        const s = await stat(bootJson);
        console.log(`Cache: ${cacheDir}`);
        console.log(`  boot.json: ${s.size} bytes, modified ${s.mtime.toISOString()}`);
      } catch {
        console.log('No cache found.');
      }
      break;
    }
    default:
      console.log('Usage: dot-ai cache <clear|status>');
      exit(1);
  }
}

// ── Init ──

async function cmdInit(): Promise<void> {
  const root = cwd();
  const aiDir = join(root, '.ai');

  try {
    await access(join(aiDir, 'settings.json'));
    console.log('.ai/settings.json already exists. Nothing to do.');
    return;
  } catch {
    // Doesn't exist, create it
  }

  await mkdir(aiDir, { recursive: true });

  await writeFile(join(aiDir, 'settings.json'), JSON.stringify({
    extensions: [],
    packages: [],
  }, null, 2) + '\n');

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

  console.log('Created:');
  console.log('  .ai/settings.json  (config)');
  console.log('  .ai/AGENTS.md      (template)');
  console.log('\nNext: add SOUL.md, USER.md, skills/, extensions/ as needed.');
}

// ── Boot ──

async function cmdBoot(): Promise<void> {
  const root = await resolveWorkspace();
  const start = performance.now();

  const runtime = new DotAiRuntime({ workspaceRoot: root });
  await runtime.boot();
  const duration = Math.round(performance.now() - start);
  const diag = runtime.diagnostics;

  console.log(`dot-ai boot — ${root}\n`);
  console.log(`Extensions: ${diag.extensions.length}`);
  console.log(`Vocabulary: ${diag.vocabularySize} labels`);
  console.log(`Tools: ${diag.capabilityCount}`);
  console.log(`Skills: ${diag.skillCount}`);
  console.log(`Identities: ${diag.identityCount}`);
  console.log(`\nBoot complete in ${duration}ms`);

  await runtime.flush();
}

// ── Trace ──

async function cmdTrace(rawArgs: string[]): Promise<void> {
  const flags = new Set(rawArgs.filter(a => a.startsWith('--')));
  const prompt = rawArgs.filter(a => !a.startsWith('--')).join(' ');
  const jsonMode = flags.has('--json');
  const verbose = flags.has('--verbose');

  if (!prompt) {
    console.error('Usage: dot-ai trace "<prompt>" [--json] [--verbose]');
    exit(1);
  }

  const root = await resolveWorkspace();
  const start = performance.now();

  const runtime = new DotAiRuntime({ workspaceRoot: root });
  await runtime.boot();
  const result = await runtime.processPrompt(prompt);
  const duration = Math.round(performance.now() - start);

  const formatted = formatSections(result.sections);

  if (jsonMode) {
    const output = {
      prompt,
      labels: result.labels?.map(l => l.name),
      routing: result.routing,
      sections: result.sections?.map(s => ({
        id: s.id,
        title: s.title,
        priority: s.priority,
        source: s.source,
        chars: s.content.length,
      })),
      totalChars: formatted.length,
      estimatedTokens: Math.round(formatted.length / 4),
      toolCount: runtime.capabilities.length,
      durationMs: duration,
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`dot-ai trace — "${prompt}"\n`);

    console.log(`Labels: [${result.labels.map(l => l.name).join(', ')}]`);

    if (result.sections.length > 0) {
      console.log(`\nSections (${result.sections.length}):`);
      for (const s of result.sections) {
        console.log(`  [${s.priority}] ${s.title} (${s.source}, ${s.content.length} chars)`);
      }
    }

    console.log(`\nRouting: ${result.routing?.model ?? 'default'} (${result.routing?.reason ?? 'none'})`);
    console.log(`Total: ${formatted.length.toLocaleString()} chars (~${Math.round(formatted.length / 4).toLocaleString()} tokens)`);
    console.log(`Tools: ${runtime.capabilities.length}`);

    if (verbose) {
      console.log(`\n── Injected markdown (${formatted.length.toLocaleString()} chars) ──`);
      console.log(formatted);
    }

    console.log(`\nTrace complete in ${duration}ms`);
  }

  await runtime.flush();
}

// ── Migrate ──

async function cmdMigrate(): Promise<void> {
  const ws = await resolveWorkspace();
  const { migrateConfig } = await import('@dot-ai/core');
  const result = await migrateConfig(ws);
  if (result) {
    console.log(`Migrated config to ${result}`);
    console.log('You can now delete .ai/dot-ai.yml');
  } else {
    console.log('No dot-ai.yml found to migrate.');
  }
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
