import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

/**
 * Resolve the bundled argus-signal script, in priority order:
 *   1. ARGUS_SIGNAL_BIN env override (dev/test escape hatch)
 *   2. binary bundled in the packaged .app (electron-builder extraResources → bin/)
 *   3. repo-relative resources/bin (dev)
 * Mirrors PtyManager.resolveTmux.
 */
export function resolveSignalBin(): string {
  if (process.env.ARGUS_SIGNAL_BIN) return process.env.ARGUS_SIGNAL_BIN;

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const bundled = path.join(resourcesPath, 'bin', 'argus-signal');
    try {
      if (existsSync(bundled)) return bundled;
    } catch {
      /* ignore */
    }
  }
  // Dev: repo_root/resources/bin/argus-signal (this file lives at
  // server/{src,dist}/services/agentSignals/, four levels under the repo root).
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../resources/bin/argus-signal');
}
