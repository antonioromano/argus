import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

/**
 * Resolve the bundled argusd binary, in priority order:
 *   1. ARGUS_DAEMON_BIN env override (dev/test escape hatch)
 *   2. binary bundled in the packaged .app (extraResources → argusd/argusd-<arch>)
 *   3. repo-relative electron/resources/argusd (built by `make -C daemon build`)
 * Named by Node's process.arch (arm64 / x64). Returns null when absent — the
 * caller falls back to the tmux backend. Mirrors PtyManager.resolveTmux.
 */
export function resolveDaemonBin(): string | null {
  if (process.env.ARGUS_DAEMON_BIN) {
    return existsSync(process.env.ARGUS_DAEMON_BIN) ? process.env.ARGUS_DAEMON_BIN : null;
  }
  const name = `argusd-${process.arch}`; // arm64 | x64

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const bundled = path.join(resourcesPath, 'argusd', name);
    try {
      if (existsSync(bundled)) return bundled;
    } catch {
      /* ignore */
    }
  }
  // Dev: repo_root/electron/resources/argusd/<name> (this file lives four levels
  // under the repo root: server/{src,dist}/services/daemon).
  const repo = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../electron/resources/argusd',
    name,
  );
  return existsSync(repo) ? repo : null;
}
