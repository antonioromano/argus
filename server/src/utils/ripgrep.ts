import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

// @vscode/ripgrep is CommonJS; createRequire lets us pull `rgPath` from our ESM build.
const require = createRequire(import.meta.url);

// undefined = not yet resolved; null = resolved-and-unavailable; string = binary path.
let cached: string | null | undefined;

function safeExists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

/**
 * Resolve a usable ripgrep binary, in priority order:
 *   1. ARGUS_RG_PATH env override (dev / test escape hatch)
 *   2. the @vscode/ripgrep binary, rewritten out of the asar when packaged
 *      (electron-builder asarUnpack ships it under app.asar.unpacked/)
 *   3. system rg on PATH
 * Result is cached. null means ripgrep is unavailable → callers fall back to grep.
 */
export function getRipgrepPath(): string | null {
  if (cached !== undefined) return cached;
  cached = resolveRipgrep();
  if (cached) {
    console.log(`[ripgrep] using ${cached}`);
  } else {
    console.warn('[ripgrep] not found — symbol search falls back to grep');
  }
  return cached;
}

function resolveRipgrep(): string | null {
  if (process.env.ARGUS_RG_PATH && safeExists(process.env.ARGUS_RG_PATH)) {
    return process.env.ARGUS_RG_PATH;
  }

  try {
    const { rgPath } = require('@vscode/ripgrep') as { rgPath: string };
    // Packaged: code runs from app.asar, but the binary is unpacked alongside it.
    const unpacked = rgPath.replace(/\bapp\.asar\b/, 'app.asar.unpacked');
    if (safeExists(unpacked)) return unpacked;
    if (safeExists(rgPath)) return rgPath;
  } catch {
    /* @vscode/ripgrep not installed */
  }

  try {
    const which = execFileSync('which', ['rg'], { encoding: 'utf-8' }).trim();
    if (which) return which;
  } catch {
    /* rg not on PATH */
  }

  return null;
}

/** Test-only: clear the memoized result so env overrides take effect. */
export function resetRipgrepCacheForTests(): void {
  cached = undefined;
}
