import path from 'path';
import { PtyManager } from '../PtyManager.js';
import { TmuxBackend } from './TmuxBackend.js';
import { DaemonBackend } from './DaemonBackend.js';
import { resolveDaemonBin } from '../daemon/resolveDaemonBin.js';
import type { PtyBackend } from './types.js';

export type { PtyBackend, SpawnOpts } from './types.js';

/**
 * Pick the pty backend. argusd is the default whenever its binary resolves; tmux
 * is the automatic fallback (binary missing) and the sole escape hatch, forced
 * with ARGUS_PTY_BACKEND=tmux if the daemon ever misbehaves in live use. The
 * daemon socket path is derived from the data dir + mode label so dev/packaged
 * isolate, matching the old tmux-socket split.
 */
export function makePtyBackend(ptyManager: PtyManager, dataDir: string): PtyBackend {
  if (process.env.ARGUS_PTY_BACKEND !== 'tmux') {
    const bin = resolveDaemonBin();
    if (bin) {
      const label = process.env.ARGUS_DAEMON_SOCKET || process.env.ARGUS_TMUX_SOCKET || 'argus';
      const socketPath = path.join(dataDir, `argusd-${label}.sock`);
      console.log('[PtyBackend] using argusd daemon backend');
      return new DaemonBackend(socketPath, bin, label);
    }
    console.warn('[PtyBackend] argusd binary not found — using tmux (build it with `make -C daemon build`)');
  }
  return new TmuxBackend(ptyManager);
}
