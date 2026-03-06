import { execSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface PackageInfo {
  name: string;
  version: string;
  dotAi?: {
    extensions?: string[];
    skills?: string[];
    providers?: string[];
  };
}

/**
 * Install a dot-ai package from npm or git.
 */
export async function install(
  source: string,
  targetDir: string,
): Promise<PackageInfo> {
  const installDir = join(targetDir, '.ai', 'packages');
  await mkdir(installDir, { recursive: true });

  execSync(`npm install --prefix "${installDir}" "${source}"`, {
    stdio: 'pipe',
    timeout: 60000,
  });

  // Read installed package info
  const name = source.startsWith('@') || !source.includes('/')
    ? source.replace(/@[^/]*$/, '')
    : source;
  return readPackageInfo(installDir, name);
}

/**
 * Remove an installed package.
 */
export async function remove(
  name: string,
  targetDir: string,
): Promise<void> {
  const installDir = join(targetDir, '.ai', 'packages');
  execSync(`npm uninstall --prefix "${installDir}" "${name}"`, {
    stdio: 'pipe',
    timeout: 60000,
  });
}

/**
 * List installed dot-ai packages.
 */
export async function listPackages(
  targetDir: string,
): Promise<PackageInfo[]> {
  const installDir = join(targetDir, '.ai', 'packages');
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
  targetDir: string,
): Promise<{ extensions: string[]; skills: string[]; providers: string[] }> {
  const packages = await listPackages(targetDir);
  const result = { extensions: [] as string[], skills: [] as string[], providers: [] as string[] };

  const installDir = join(targetDir, '.ai', 'packages');
  for (const pkg of packages) {
    if (!pkg.dotAi) continue;
    const pkgDir = join(installDir, 'node_modules', pkg.name);

    if (pkg.dotAi.extensions) {
      result.extensions.push(...pkg.dotAi.extensions.map(e => join(pkgDir, e)));
    }
    if (pkg.dotAi.skills) {
      result.skills.push(...pkg.dotAi.skills.map(s => join(pkgDir, s)));
    }
    if (pkg.dotAi.providers) {
      result.providers.push(...pkg.dotAi.providers.map(p => join(pkgDir, p)));
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
