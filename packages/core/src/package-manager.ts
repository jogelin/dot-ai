import { execSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface PackageInfo {
  name: string;
  version: string;
  dotAi?: {
    extensions?: string[];
    skills?: string[];
    providers?: string[];
  };
}

export type MissingPackageAction = 'install' | 'skip' | 'error';

/**
 * Parse a package source string into name and spec.
 *
 * Supported formats:
 * - "npm:@dot-ai/ext-memory@1.0.0" → { name: "@dot-ai/ext-memory", spec: "@dot-ai/ext-memory@1.0.0" }
 * - "npm:@dot-ai/ext-memory" → { name: "@dot-ai/ext-memory", spec: "@dot-ai/ext-memory" }
 * - "@dot-ai/ext-memory@1.0.0" → { name: "@dot-ai/ext-memory", spec: "@dot-ai/ext-memory@1.0.0" }
 * - "@dot-ai/ext-memory" → { name: "@dot-ai/ext-memory", spec: "@dot-ai/ext-memory" }
 */
function parsePackageSource(source: string): { name: string; spec: string } {
  // Strip npm: prefix
  const raw = source.startsWith('npm:') ? source.slice(4) : source;

  // Extract name (without version) for scoped packages
  if (raw.startsWith('@')) {
    // @scope/name@version → name = @scope/name
    const slashIdx = raw.indexOf('/');
    if (slashIdx === -1) return { name: raw, spec: raw };
    const afterSlash = raw.slice(slashIdx + 1);
    const atIdx = afterSlash.indexOf('@');
    if (atIdx === -1) return { name: raw, spec: raw };
    return { name: raw.slice(0, slashIdx + 1 + atIdx), spec: raw };
  }

  // name@version → name = name
  const atIdx = raw.indexOf('@');
  if (atIdx === -1) return { name: raw, spec: raw };
  return { name: raw.slice(0, atIdx), spec: raw };
}

/**
 * Get the install directory for packages.
 */
function getInstallDir(workspaceRoot: string): string {
  return join(workspaceRoot, '.ai', 'packages');
}

/**
 * Check if a package is already installed in .ai/packages/.
 */
function isPackageInstalled(installDir: string, name: string): boolean {
  return existsSync(join(installDir, 'node_modules', name, 'package.json'));
}

/**
 * Install a single npm package into .ai/packages/.
 */
async function installNpm(spec: string, installDir: string): Promise<void> {
  await mkdir(installDir, { recursive: true });

  // Ensure package.json exists (npm --prefix needs it)
  const pkgJsonPath = join(installDir, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    await writeFile(pkgJsonPath, JSON.stringify({ private: true, dependencies: {} }, null, 2) + '\n');
  }

  execSync(`npm install --prefix "${installDir}" "${spec}"`, {
    stdio: 'pipe',
    timeout: 60000,
  });
}

/**
 * Install a dot-ai package from npm.
 *
 * Installs into `.ai/packages/node_modules/`.
 */
export async function install(
  source: string,
  workspaceRoot: string,
): Promise<PackageInfo> {
  const installDir = getInstallDir(workspaceRoot);
  const { name, spec } = parsePackageSource(source);

  await installNpm(spec, installDir);
  return readPackageInfo(installDir, name);
}

/**
 * Remove an installed package.
 */
export async function remove(
  name: string,
  workspaceRoot: string,
): Promise<void> {
  const installDir = getInstallDir(workspaceRoot);
  execSync(`npm uninstall --prefix "${installDir}" "${name}"`, {
    stdio: 'pipe',
    timeout: 60000,
  });
}

/**
 * List installed dot-ai packages.
 */
export async function listPackages(
  workspaceRoot: string,
): Promise<PackageInfo[]> {
  const installDir = getInstallDir(workspaceRoot);
  const pkgJsonPath = join(installDir, 'package.json');

  try {
    const raw = await readFile(pkgJsonPath, 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const deps = pkg.dependencies as Record<string, string> | undefined;
    if (!deps) return [];

    const packages: PackageInfo[] = [];
    for (const name of Object.keys(deps)) {
      try {
        const info = await readPackageInfo(installDir, name);
        packages.push(info);
      } catch {
        packages.push({ name, version: deps[name] });
      }
    }
    return packages;
  } catch {
    return [];
  }
}

/**
 * Resolve dot-ai manifest from installed packages.
 */
export async function resolvePackages(
  workspaceRoot: string,
): Promise<{ extensions: string[]; skills: string[]; providers: string[] }> {
  const packages = await listPackages(workspaceRoot);
  const result = { extensions: [] as string[], skills: [] as string[], providers: [] as string[] };

  const installDir = getInstallDir(workspaceRoot);
  for (const pkg of packages) {
    if (!pkg.dotAi) continue;
    const pkgDir = join(installDir, 'node_modules', pkg.name);

    if (pkg.dotAi.extensions) {
      result.extensions.push(...pkg.dotAi.extensions.map(e => resolve(pkgDir, e)));
    }
    if (pkg.dotAi.skills) {
      result.skills.push(...pkg.dotAi.skills.map(s => resolve(pkgDir, s)));
    }
    if (pkg.dotAi.providers) {
      result.providers.push(...pkg.dotAi.providers.map(p => resolve(pkgDir, p)));
    }
  }

  return result;
}

/**
 * Ensure all packages from settings.json are installed.
 *
 * Like Pi's `resolvePackageSources()` with auto-install:
 * - Reads the `packages` array from settings.json config
 * - For each package, checks if it's already installed in `.ai/packages/`
 * - If not installed, auto-installs it via npm
 * - The `onMissing` callback allows callers to control behavior (install/skip/error)
 *
 * This should be called BEFORE `discoverExtensions()` in the boot flow,
 * so that installed packages are available for extension discovery.
 */
export async function ensurePackagesInstalled(
  workspaceRoot: string,
  packages: string[],
  onMissing?: (source: string) => Promise<MissingPackageAction>,
): Promise<{ installed: string[]; skipped: string[]; errors: Array<{ source: string; error: string }> }> {
  const installDir = getInstallDir(workspaceRoot);
  const result = {
    installed: [] as string[],
    skipped: [] as string[],
    errors: [] as Array<{ source: string; error: string }>,
  };

  for (const source of packages) {
    const { name, spec } = parsePackageSource(source);

    // Already installed? Skip.
    if (isPackageInstalled(installDir, name)) {
      result.skipped.push(source);
      continue;
    }

    // Determine action for missing package
    let action: MissingPackageAction = 'install';
    if (onMissing) {
      action = await onMissing(source);
    }

    if (action === 'skip') {
      result.skipped.push(source);
      continue;
    }

    if (action === 'error') {
      result.errors.push({ source, error: `Missing package: ${source}` });
      continue;
    }

    // Auto-install
    try {
      await installNpm(spec, installDir);
      result.installed.push(source);
    } catch (err) {
      result.errors.push({
        source,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

async function readPackageInfo(installDir: string, name: string): Promise<PackageInfo> {
  const pkgPath = join(installDir, 'node_modules', name, 'package.json');
  const raw = await readFile(pkgPath, 'utf-8');
  const pkg = JSON.parse(raw) as Record<string, unknown>;

  return {
    name: pkg.name as string,
    version: pkg.version as string,
    dotAi: pkg['dot-ai'] as PackageInfo['dotAi'],
  };
}
