import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { DaemonBackend } from './DaemonBackend.js';
import { resolveDaemonBin } from '../daemon/resolveDaemonBin.js';

const BIN = resolveDaemonBin();
// Needs the compiled argusd binary (`make -C daemon build`, present locally and
// in the CI Go job). Without it the daemon path can't be exercised at all.
const guard = BIN ? undefined : { skip: 'argusd binary not built (run make -C daemon build)' };

function shortSocket(): { socketPath: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ad'));
  return { socketPath: path.join(dir, 's.sock'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function spawnOpts(sessionId: string, command: string) {
  return { sessionId, folderPath: os.tmpdir(), command, cols: 80, rows: 24, flags: [], extraEnv: {}, attachExisting: false };
}

async function waitFor(cond: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

// A restart kills and respawns the SAME session id. Daemon exit frames carry only
// that id, so the dying agent's exit is delivered to whatever pty is subscribed
// when it lands — the replacement, if the respawn didn't wait. SessionManager
// then marks the just-restarted shell exited and it stops responding.
test('DaemonBackend: a restart on the same id never delivers the old exit to the fresh pty', guard ?? {}, async () => {
  const { socketPath, cleanup } = shortSocket();
  const backend = new DaemonBackend(socketPath, BIN!, 'test');
  await backend.ready();

  try {
    const first = backend.spawn(spawnOpts('r1', "sh -c 'printf FIRST; sleep 30'"));
    let firstOut = '';
    first.onData((d) => { firstOut += d; });
    await waitFor(() => /FIRST/.test(firstOut));

    await backend.stopSessionAndWait('r1');

    const fresh = backend.spawn(spawnOpts('r1', 'cat'));
    let exits = 0;
    let freshOut = '';
    fresh.onExit(() => { exits += 1; });
    fresh.onData((d) => { freshOut += d; });

    await new Promise((r) => setTimeout(r, 300)); // window the stale exit would land in
    fresh.write('ping\n');
    // The fresh agent must still be reachable: the old session's teardown must not
    // have evicted it from the daemon's table either.
    await waitFor(() => /ping/.test(freshOut));

    assert.equal(exits, 0, 'the old agent’s exit leaked onto the restarted session');
  } finally {
    backend.stopAll();
    cleanup();
  }
});
