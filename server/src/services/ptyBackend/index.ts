import path from 'path';
import { PtyManager } from '../PtyManager.js';
import { TmuxBackend } from './TmuxBackend.js';
import { DaemonBackend } from './DaemonBackend.js';
import { resolveDaemonBin } from '../daemon/resolveDaemonBin.js';
import type { PtyBackend } from './types.js';

export type { PtyBackend, SpawnOpts } from './types.js';

/**
 * Pick the pty backend. argusd is the default ('auto') whenever its binary
 * resolves; tmux is the automatic fallback (binary missing) and the escape hatch
 * (config `ptyBackend: 'tmux'`, or the ARGUS_PTY_BACKEND=tmux dev override, which
 * wins over config). The daemon socket path is derived from the data dir + mode
 * label so dev/packaged isolate, matching the old tmux-socket split.
 */
export function makePtyBackend(
  ptyManager: PtyManager,
  dataDir: string,
  preference: 'auto' | 'tmux' = 'auto',
): PtyBackend {
  const env = process.env.ARGUS_PTY_BACKEND; // dev override, wins over config
  const wantTmux = env ? env === 'tmux' : preference === 'tmux';
  if (!wantTmux) {
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
