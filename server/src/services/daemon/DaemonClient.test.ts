import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { DaemonClient, DaemonPty } from './DaemonClient.js';
import { resolveDaemonBin } from './resolveDaemonBin.js';

const BIN = resolveDaemonBin();
// The client↔daemon integration needs the compiled argusd binary. It's built by
// `make -C daemon build` (present locally + in the CI Go job). When absent
// (Node CI job without the binary), skip — the daemon's own logic is covered by
// the Go test suite.
const guard = BIN ? undefined : { skip: 'argusd binary not built (run make -C daemon build)' };

function shortSocket(): { socketPath: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ad'));
  return { socketPath: path.join(dir, 's.sock'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function collectData(pty: DaemonPty): { text: () => string } {
  let buf = '';
  pty.onData((d) => {
    buf += d;
  });
  return { text: () => buf };
}

async function waitFor(cond: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

test('DaemonClient: spawn → output → exit code via DaemonPty', guard ?? {}, async () => {
  const { socketPath, cleanup } = shortSocket();
  const client = new DaemonClient(socketPath, BIN!, 'test');
  await client.ensureConnected();
  const pty = new DaemonPty(client, 's1');
  const out = collectData(pty);
  let exitCode: number | undefined;
  pty.onExit(({ exitCode: c }) => {
    exitCode = c;
  });

  client.spawn('s1', ['/bin/sh', '-c', 'printf HELLO; exit 3'], os.tmpdir(), {}, 80, 24);
  await waitFor(() => exitCode !== undefined);

  assert.match(out.text(), /HELLO/, 'received pty output');
  assert.equal(exitCode, 3, 'exit code propagated');

  client.killAll();
  client.dispose();
  cleanup();
});

test('DaemonClient: write reaches the pty (cat echoes input)', guard ?? {}, async () => {
  const { socketPath, cleanup } = shortSocket();
  const client = new DaemonClient(socketPath, BIN!, 'test');
  await client.ensureConnected();
  const pty = new DaemonPty(client, 'cat1');
  const out = collectData(pty);
  client.spawn('cat1', ['/bin/cat'], os.tmpdir(), {}, 80, 24);
  await new Promise((r) => setTimeout(r, 200));
  pty.write('roundtrip\n');
  await waitFor(() => /roundtrip/.test(out.text()));
  assert.match(out.text(), /roundtrip/);
  client.killAll();
  client.dispose();
  cleanup();
});

test('DaemonClient: list reports live sessions', guard ?? {}, async () => {
  const { socketPath, cleanup } = shortSocket();
  const client = new DaemonClient(socketPath, BIN!, 'test');
  await client.ensureConnected();
  new DaemonPty(client, 'live1');
  client.spawn('live1', ['/bin/sh', '-c', 'sleep 20'], os.tmpdir(), {}, 80, 24);
  await new Promise((r) => setTimeout(r, 200));
  const ids = await client.list();
  assert.ok(ids.includes('live1'), `list should include live1, got ${JSON.stringify(ids)}`);
  client.killAll();
  client.dispose();
  cleanup();
});

test('DaemonClient: reconnect + attach replays the backlog (survivor)', guard ?? {}, async () => {
  const { socketPath, cleanup } = shortSocket();

  const c1 = new DaemonClient(socketPath, BIN!, 'test');
  await c1.ensureConnected();
  const p1 = new DaemonPty(c1, 'keep');
  const out1 = collectData(p1);
  c1.spawn('keep', ['/bin/sh', '-c', 'printf MARKER; sleep 30'], os.tmpdir(), {}, 80, 24);
  await waitFor(() => /MARKER/.test(out1.text()));
  p1.dispose();
  c1.dispose(); // drop the connection — daemon keeps the session alive

  await new Promise((r) => setTimeout(r, 150));

  const c2 = new DaemonClient(socketPath, BIN!, 'test');
  await c2.ensureConnected(); // connects to the SAME running daemon
  const p2 = new DaemonPty(c2, 'keep');
  const out2 = collectData(p2);
  c2.attach('keep');
  await waitFor(() => /MARKER/.test(out2.text()), 4000);
  assert.match(out2.text(), /MARKER/, 'backlog replayed the pre-disconnect output');

  c2.killAll();
  c2.dispose();
  cleanup();
});
