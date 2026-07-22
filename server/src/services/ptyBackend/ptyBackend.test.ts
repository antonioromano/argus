import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import type { IPty } from 'node-pty';
import { PtyManager } from '../PtyManager.js';
import { makePtyBackend } from './index.js';
import { resolveDaemonBin } from '../daemon/resolveDaemonBin.js';

const BIN = resolveDaemonBin();
const daemonGuard = BIN ? undefined : { skip: 'argusd binary not built (run make -C daemon build)' };

test('makePtyBackend defaults to the tmux backend', () => {
  const prev = process.env.ARGUS_PTY_BACKEND;
  delete process.env.ARGUS_PTY_BACKEND;
  try {
    const b = makePtyBackend(new PtyManager(os.tmpdir()), os.tmpdir());
    assert.equal(b.kind, 'tmux');
  } finally {
    if (prev !== undefined) process.env.ARGUS_PTY_BACKEND = prev;
  }
});

test('makePtyBackend falls back to tmux when daemon requested but binary missing', () => {
  const prevF = process.env.ARGUS_PTY_BACKEND;
  const prevB = process.env.ARGUS_DAEMON_BIN;
  process.env.ARGUS_PTY_BACKEND = 'daemon';
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
