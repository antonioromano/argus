import path from 'path';
import { readdirSync, readFileSync } from 'fs';
import { PtyManager } from '../PtyManager.js';
import { TmuxBackend } from './TmuxBackend.js';
import { DaemonBackend } from './DaemonBackend.js';
import { resolveDaemonBin } from '../daemon/resolveDaemonBin.js';
import type { PtyBackend } from './types.js';

export type { PtyBackend, SpawnOpts } from './types.js';

/** `process.kill(pid, 0)` liveness: EPERM still means the process exists. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Live argusd daemons serving `dataDir` under a socket other than ours. Each
 * daemon writes `<socket>.pid` next to its socket; a stale file (pid gone) is
 * ignored. Never kills anything — it only reports.
 *
 * Why it matters: a dev data dir was found with both argusd-argus-dev.sock and
 * argusd-argus.sock daemons alive, each running the same three session ids —
 * every agent was running twice, and nothing in the UI said so.
 */
export function findDuplicateDaemons(
  dataDir: string,
  ownSocketPath: string,
  isAlive: (pid: number) => boolean = pidAlive,
): { socket: string; pid: number }[] {
  let names: string[];
  try {
    names = readdirSync(dataDir);
  } catch {
    return [];
  }
  const own = path.basename(ownSocketPath);
  const found: { socket: string; pid: number }[] = [];
  for (const name of names) {
    if (!/^argusd-.+\.sock\.pid$/.test(name)) continue;
    const socket = name.slice(0, -'.pid'.length);
    if (socket === own) continue;
    let pid: number;
    try {
      pid = Number.parseInt(readFileSync(path.join(dataDir, name), 'utf-8').trim(), 10);
    } catch {
      continue;
    }
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    if (isAlive(pid)) found.push({ socket: path.join(dataDir, socket), pid });
  }
  return found;
}

/**
 * The daemon socket for `dataDir`. The label comes from the env (per-mode
 * isolation), but the env is easy to inherit wrongly: every Argus session
 * exports ARGUS_DAEMON_SOCKET/ARGUS_TMUX_SOCKET=argus, so a server started by
 * hand from inside one (`ARGUS_DATA_DIR=…/argus-dev npx tsx …`) picked label
 * 'argus' on the dev data dir, spawned a second daemon there, and restored the
 * same sessions into it — every agent ran twice for days. The data dir is what
 * owns the sessions, so a daemon already live on it wins: adopt it rather than
 * start another. (argusd also refuses to start on a dir another daemon holds.)
 */
export function chooseDaemonSocket(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  isAlive: (pid: number) => boolean = pidAlive,
): { socketPath: string; label: string } {
  const label = env.ARGUS_DAEMON_SOCKET || env.ARGUS_TMUX_SOCKET || 'argus';
  const socketPath = path.join(dataDir, `argusd-${label}.sock`);
  if (daemonPidAlive(socketPath, isAlive)) return { socketPath, label };
  const others = findDuplicateDaemons(dataDir, socketPath, isAlive);
  if (others.length !== 1) return { socketPath, label };
  const adopted = others[0].socket;
  const adoptedLabel = path.basename(adopted).replace(/^argusd-/, '').replace(/\.sock$/, '');
  console.warn(
    `[PtyBackend] a daemon already serves this data dir as ${adopted} (pid ${others[0].pid}); ` +
      `adopting it instead of starting a second one for label '${label}'`,
  );
  return { socketPath: adopted, label: adoptedLabel };
}

function daemonPidAlive(socketPath: string, isAlive: (pid: number) => boolean): boolean {
  try {
    const pid = Number.parseInt(readFileSync(`${socketPath}.pid`, 'utf-8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 && isAlive(pid);
  } catch {
    return false;
  }
}

/**
 * Pick the pty backend. argusd is the default ('auto') whenever its binary
 * resolves; tmux is the automatic fallback (binary missing) and the escape hatch
 * (config `ptyBackend: 'tmux'`, or the ARGUS_PTY_BACKEND=tmux dev override, which
 * wins over config). The daemon socket lives in the data dir; see chooseDaemonSocket.
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
      const { socketPath, label } = chooseDaemonSocket(dataDir);
      console.log('[PtyBackend] using argusd daemon backend');
      for (const dup of findDuplicateDaemons(dataDir, socketPath)) {
        console.warn(
          `[PtyBackend] WARNING: duplicate daemon on this data dir — sessions may be running twice: ` +
            `${dup.socket} (pid ${dup.pid}) is live alongside ours (${socketPath}). ` +
            `Nothing was stopped; quit the other Argus instance or kill that daemon.`,
        );
      }
      return new DaemonBackend(socketPath, bin, label);
    }
    console.warn('[PtyBackend] argusd binary not found — using tmux (build it with `make -C daemon build`)');
  }
  return new TmuxBackend(ptyManager);
}
