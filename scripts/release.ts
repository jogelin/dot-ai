/**
 * Custom release script using Nx Release Programmatic API.
 *
 * Wraps releaseVersion + releaseChangelog + releasePublish and bumps
 * plugin manifest versions (plugin.json, marketplace.json, openclaw.plugin.json)
 * in the same git commit as the package.json bumps.
 *
 * Usage:
 *   pnpm tsx scripts/release.ts [--specifier=patch|minor|major|1.0.0] [--dry-run] [--verbose]
 *
 * Without --specifier, the bump is auto-detected from conventional commits.
 */

import { releaseChangelog, releasePublish, releaseVersion } from 'nx/release';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MANIFEST_FILES = [
  'openclaw.plugin.json',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  'packages/adapter-claude/plugin.json',
];

const dryRun = process.argv.includes('--dry-run');
const verbose = process.argv.includes('--verbose');
const specifierArg = process.argv.find((a) => a.startsWith('--specifier='));
const specifier = specifierArg ? specifierArg.split('=')[1] : undefined;

async function main() {
  // 1. Version all packages (writes package.json files, but does NOT git commit yet)
  // git commit/tag disabled in nx.json version.git — changelog handles it
  const { workspaceVersion, projectsVersionData } = await releaseVersion({
    specifier,
    dryRun,
    verbose,
  });

  // 2. Nothing to release?
  if (!workspaceVersion) {
    console.log('No version bump needed — nothing to release.');
    process.exit(0);
  }

  // 3. Sync plugin manifests with the new version
  for (const filePath of MANIFEST_FILES) {
    const abs = resolve(filePath);
    try {
      const json = JSON.parse(readFileSync(abs, 'utf-8'));
      const oldVersion = json.version;
      json.version = workspaceVersion;
      // marketplace.json nests version inside plugins[].version
      if (Array.isArray(json.plugins)) {
        for (const plugin of json.plugins) {
          plugin.version = workspaceVersion;
        }
      }
      if (!dryRun) {
        writeFileSync(abs, JSON.stringify(json, null, 2) + '\n');
      }
      console.log(
        `${dryRun ? '[dry-run] ' : ''}Updated ${filePath}: ${oldVersion ?? 'n/a'} → ${workspaceVersion}`,
      );
    } catch (err) {
      console.warn(`Warning: could not update ${filePath}:`, (err as Error).message);
    }
  }

  // 4. Generate changelog + create git commit & tag (includes all file changes)
  await releaseChangelog({
    version: workspaceVersion,
    versionData: projectsVersionData,
    dryRun,
    verbose,
  });

  // 5. Publish to npm
  const publishResult = await releasePublish({ dryRun, verbose });

  // Exit with error if any publish failed
  const publishStatus = Object.values(publishResult).reduce(
    (code, result) => (result.code !== 0 ? 1 : code),
    0,
  );
  process.exit(publishStatus);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
