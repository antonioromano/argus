import path from 'path';
import { PtyManager } from '../PtyManager.js';
import { TmuxBackend } from './TmuxBackend.js';
import { DaemonBackend } from './DaemonBackend.js';
import { resolveDaemonBin } from '../daemon/resolveDaemonBin.js';
import type { PtyBackend } from './types.js';

export type { PtyBackend, SpawnOpts } from './types.js';

/**
 * Pick the pty backend. Default 'tmux' (unchanged behavior); 'daemon' opts into
 * argusd (experimental, plan 003 R7) and falls back to tmux if the binary is
 * missing. The daemon socket path is derived from the data dir + mode label so
 * dev/packaged isolate, matching the tmux-socket split.
 */
export function makePtyBackend(ptyManager: PtyManager, dataDir: string): PtyBackend {
  if (process.env.ARGUS_PTY_BACKEND === 'daemon') {
    const bin = resolveDaemonBin();
    if (bin) {
      const label = process.env.ARGUS_DAEMON_SOCKET || process.env.ARGUS_TMUX_SOCKET || 'argus';
      const socketPath = path.join(dataDir, `argusd-${label}.sock`);
      console.log('[PtyBackend] using argusd daemon backend (experimental)');
      return new DaemonBackend(socketPath, bin, label);
    }
    console.warn('[PtyBackend] ARGUS_PTY_BACKEND=daemon but argusd binary not found — using tmux');
  }
  return new TmuxBackend(ptyManager);
}
