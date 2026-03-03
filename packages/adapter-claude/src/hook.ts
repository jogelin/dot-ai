#!/usr/bin/env node
/**
 * dot-ai hook for Claude Code.
 * Receives hook event JSON on stdin, runs the enrich pipeline,
 * returns enriched context on stdout.
 *
 * Usage in hooks.json:
 *   { "type": "command", "command": "node /path/to/hook.js" }
 */
import { loadConfig, registerDefaults, createProviders, boot, enrich, injectRoot, formatContext } from '@dot-ai/core';

async function main(): Promise<void> {
  // Read event from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    process.stderr.write('[dot-ai] Failed to parse stdin JSON\n');
    return;
  }

  // Find workspace root (try event data, then cwd)
  const workspaceRoot = (event.cwd as string) ?? process.cwd();

  try {
    // Run the pipeline
    registerDefaults();
    const rawConfig = await loadConfig(workspaceRoot);

    // Inject workspaceRoot into all provider options
    const config = injectRoot(rawConfig, workspaceRoot);
    const providers = await createProviders(config);
    const cache = await boot(providers);

    // Extract prompt from the event
    const prompt = (event.prompt ?? event.content ?? '') as string;

    if (!prompt) {
      // No prompt to enrich (e.g., SessionStart) — just inject identities
      const identityContext = cache.identities
        .sort((a, b) => b.priority - a.priority)
        .map(i => i.content)
        .join('\n\n---\n\n');

      if (identityContext) {
        process.stdout.write(JSON.stringify({ result: identityContext }));
      }
      return;
    }

    // Enrich the prompt
    const enriched = await enrich(prompt, providers, cache);

    // Load skill content for matched skills
    for (const skill of enriched.skills) {
      if (!skill.content && skill.name) {
        skill.content = await providers.skills.load(skill.name) ?? undefined;
      }
    }

    // Format and output (skip identities — already injected at SessionStart)
    const formatted = formatContext(enriched, {
      skipIdentities: true,
      maxSkillLength: 3000,
      maxSkills: 5,
    });
    if (formatted) {
      process.stdout.write(JSON.stringify({ result: formatted }));
    }
  } catch (err) {
    // Fail silently — don't block the agent
    process.stderr.write(`[dot-ai] Error: ${err}\n`);
  }
}

main();
