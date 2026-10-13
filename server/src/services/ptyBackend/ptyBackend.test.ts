import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import type { IPty } from 'node-pty';
import { PtyManager } from '../PtyManager.js';
import { makePtyBackend, findDuplicateDaemons, chooseDaemonSocket } from './index.js';
import { resolveDaemonBin } from '../daemon/resolveDaemonBin.js';

const BIN = resolveDaemonBin();
const daemonGuard = BIN ? undefined : { skip: 'argusd binary not built (run make -C daemon build)' };

test('makePtyBackend: ARGUS_PTY_BACKEND=tmux forces the tmux backend', () => {
  const prev = process.env.ARGUS_PTY_BACKEND;
  process.env.ARGUS_PTY_BACKEND = 'tmux';
  try {
    const b = makePtyBackend(new PtyManager(os.tmpdir()), os.tmpdir());
    assert.equal(b.kind, 'tmux');
  } finally {
    if (prev !== undefined) process.env.ARGUS_PTY_BACKEND = prev;
    else delete process.env.ARGUS_PTY_BACKEND;
  }
});

test('makePtyBackend: defaults to daemon when the binary resolves', daemonGuard ?? {}, () => {
  const prevF = process.env.ARGUS_PTY_BACKEND;
  const prevB = process.env.ARGUS_DAEMON_BIN;
  delete process.env.ARGUS_PTY_BACKEND;
  process.env.ARGUS_DAEMON_BIN = BIN!;
  try {
    const b = makePtyBackend(new PtyManager(os.tmpdir()), os.tmpdir());
    assert.equal(b.kind, 'daemon', 'daemon is the default when its binary is available');
  } finally {
    if (prevF !== undefined) process.env.ARGUS_PTY_BACKEND = prevF;
    else delete process.env.ARGUS_PTY_BACKEND;
    if (prevB !== undefined) process.env.ARGUS_DAEMON_BIN = prevB;
    else delete process.env.ARGUS_DAEMON_BIN;
  }
});

test('makePtyBackend: falls back to tmux when the binary is missing', () => {
  const prevF = process.env.ARGUS_PTY_BACKEND;
  const prevB = process.env.ARGUS_DAEMON_BIN;
  delete process.env.ARGUS_PTY_BACKEND;
  process.env.ARGUS_DAEMON_BIN = '/nonexistent/argusd';
  try {
    const b = makePtyBackend(new PtyManager(os.tmpdir()), os.tmpdir());
    assert.equal(b.kind, 'tmux', 'missing binary → tmux fallback');
  } finally {
    if (prevF !== undefined) process.env.ARGUS_PTY_BACKEND = prevF;
    else delete process.env.ARGUS_PTY_BACKEND;
    if (prevB !== undefined) process.env.ARGUS_DAEMON_BIN = prevB;
    else delete process.env.ARGUS_DAEMON_BIN;
  }
});

test('DaemonBackend: spawn round-trips output + exit through the IPty surface', daemonGuard ?? {}, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ab'));
  const prevF = process.env.ARGUS_PTY_BACKEND;
  const prevB = process.env.ARGUS_DAEMON_BIN;
  const prevS = process.env.ARGUS_DAEMON_SOCKET;
  process.env.ARGUS_PTY_BACKEND = 'daemon';
  process.env.ARGUS_DAEMON_BIN = BIN!;
  process.env.ARGUS_DAEMON_SOCKET = 'bktest';
  try {
    const backend = makePtyBackend(new PtyManager(dir), dir);
    assert.equal(backend.kind, 'daemon');
    await backend.ready?.();

    const pty = backend.spawn({
      sessionId: 'bk1',
      folderPath: os.tmpdir(),
      command: 'sh',
      cols: 80,
      rows: 24,
      flags: ['-c', 'printf DONE; exit 5'],
      extraEnv: {},
      attachExisting: false,
    }) as IPty;

    let out = '';
    let code: number | undefined;
    pty.onData((d) => {
      out += d;
    });
    pty.onExit(({ exitCode }) => {
      code = exitCode;
    });

    const deadline = Date.now() + 5000;
    while (code === undefined && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));

    assert.match(out, /DONE/, 'output flowed through DaemonPty.onData');
    assert.equal(code, 5, 'exit code flowed through DaemonPty.onExit');

    backend.stopAll();
  } finally {
    if (prevF !== undefined) process.env.ARGUS_PTY_BACKEND = prevF;
    else delete process.env.ARGUS_PTY_BACKEND;
    if (prevB !== undefined) process.env.ARGUS_DAEMON_BIN = prevB;
    else delete process.env.ARGUS_DAEMON_BIN;
    if (prevS !== undefined) process.env.ARGUS_DAEMON_SOCKET = prevS;
    else delete process.env.ARGUS_DAEMON_SOCKET;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('findDuplicateDaemons reports live daemons under other labels on the same data dir', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'argus-dupd-'));
  try {
    const own = path.join(dir, 'argusd-argus-dev.sock');
    writeFileSync(`${own}.pid`, '111'); // ourselves — never reported
    writeFileSync(path.join(dir, 'argusd-argus.sock.pid'), '222\n'); // live duplicate
    writeFileSync(path.join(dir, 'argusd-old.sock.pid'), '333'); // stale pid file
    writeFileSync(path.join(dir, 'argusd-junk.sock.pid'), 'not-a-pid');
    writeFileSync(path.join(dir, 'unrelated.pid'), '222');
    const alive = new Set([111, 222]);
    const dups = findDuplicateDaemons(dir, own, (pid) => alive.has(pid));
    assert.deepEqual(dups, [{ socket: path.join(dir, 'argusd-argus.sock'), pid: 222 }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('findDuplicateDaemons uses real liveness by default and tolerates a missing dir', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'argus-dupd-'));
  try {
    // A pid that cannot exist on macOS/Linux (beyond pid_max) reads as dead.
    writeFileSync(path.join(dir, 'argusd-x.sock.pid'), '2147483646');
    assert.deepEqual(findDuplicateDaemons(dir, path.join(dir, 'argusd-y.sock')), []);
    // process.ppid is certainly alive.
    writeFileSync(path.join(dir, 'argusd-z.sock.pid'), String(process.ppid));
    assert.deepEqual(findDuplicateDaemons(dir, path.join(dir, 'argusd-y.sock')).map((d) => d.pid), [process.ppid]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(findDuplicateDaemons(path.join(dir, 'gone'), 'x'), []);
});

test('chooseDaemonSocket adopts the one live daemon on the data dir instead of starting a second', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'argus-adopt-'));
  try {
    // Real incident: a dev launched from an Argus terminal inherited label 'argus'
    // while the dev dir's daemon was 'argus-dev'.
    writeFileSync(path.join(dir, 'argusd-argus-dev.sock.pid'), '222');
    const alive = new Set([222]);
    const got = chooseDaemonSocket(dir, { ARGUS_DAEMON_SOCKET: 'argus' }, (pid) => alive.has(pid));
    assert.deepEqual(got, { socketPath: path.join(dir, 'argusd-argus-dev.sock'), label: 'argus-dev' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chooseDaemonSocket keeps the env label when its own daemon is live or none is', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'argus-adopt-'));
  try {
    const own = { socketPath: path.join(dir, 'argusd-argus.sock'), label: 'argus' };
    assert.deepEqual(chooseDaemonSocket(dir, { ARGUS_DAEMON_SOCKET: 'argus' }, () => false), own, 'nothing live → spawn ours');
    writeFileSync(path.join(dir, 'argusd-argus.sock.pid'), '111');
    writeFileSync(path.join(dir, 'argusd-other.sock.pid'), '222');
    const alive = new Set([111, 222]);
    assert.deepEqual(chooseDaemonSocket(dir, { ARGUS_DAEMON_SOCKET: 'argus' }, (pid) => alive.has(pid)), own, 'ours live → ours');
    assert.deepEqual(chooseDaemonSocket(dir, { ARGUS_TMUX_SOCKET: 'argus' }, () => true), own, 'falls back to the tmux label');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
