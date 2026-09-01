import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { DaemonClient, DaemonPty } from './DaemonClient.js';
import { resolveDaemonBin } from './resolveDaemonBin.js';

const BIN = resolveDaemonBin();
const guard = BIN ? undefined : { skip: 'argusd binary not built (run make -C daemon build)' };

const KIND_CONTROL = 0x43;
const KIND_DATA = 0x44;

function shortSocket(): { socketPath: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ad'));
  return { socketPath: path.join(dir, 's.sock'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function frame(kind: number, id: string, payload: Buffer): Buffer {
  const idBuf = Buffer.from(id, 'utf8');
  const body = Buffer.concat([Buffer.from([kind, idBuf.length]), idBuf, payload]);
  const hdr = Buffer.alloc(4);
  hdr.writeUInt32BE(body.length, 0);
  return Buffer.concat([hdr, body]);
}

interface Ctl { op: string; id?: string; version?: number }

/**
 * A stand-in for argusd that records the control frames it receives and only
 * acks an attach when the test says so — the point being to observe WHEN the
 * client sends each attach, which a real daemon (which acks immediately) hides.
 */
function fakeDaemon(opts: { closeWithoutHello?: boolean } = {}) {
  const { socketPath, cleanup } = shortSocket();
  const received: Ctl[] = [];
  let sock: net.Socket | null = null;
  const server = net.createServer((s) => {
    if (opts.closeWithoutHello) {
      s.destroy(); // what a single-consumer daemon does to a second connection
      return;
    }
    sock = s;
    s.write(frame(KIND_CONTROL, '', Buffer.from(JSON.stringify({ op: 'hello', version: 1 }))));
    let rx = Buffer.alloc(0);
    s.on('data', (chunk) => {
      rx = Buffer.concat([rx, chunk]);
      for (;;) {
        if (rx.length < 4) return;
        const len = rx.readUInt32BE(0);
        if (rx.length < 4 + len) return;
        const body = rx.subarray(4, 4 + len);
        rx = rx.subarray(4 + len);
        if (body[0] === KIND_CONTROL) {
          const idLen = body[1]!;
          received.push(JSON.parse(body.subarray(2 + idLen).toString('utf8')) as Ctl);
        }
      }
    });
  });
  const listening = new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    socketPath,
    received,
    listening,
    ack: (id: string) => sock?.write(frame(KIND_CONTROL, '', Buffer.from(JSON.stringify({ op: 'attached', id })))),
    send: (id: string, data: string) => sock?.write(frame(KIND_DATA, id, Buffer.from(data, 'utf8'))),
    close: () => {
      sock?.destroy();
      server.close();
      cleanup();
    },
  };
}

async function waitFor(cond: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const attaches = (received: Ctl[]) => received.filter((c) => c.op === 'attach').map((c) => c.id);

test('DaemonClient: attaches are sent one at a time, each waiting for its ack', async () => {
  const fake = fakeDaemon();
  await fake.listening;
  const client = new DaemonClient(fake.socketPath, '/nonexistent', 'test');
  await client.ensureConnected();

  client.attach('a');
  client.attach('b');
  client.attach('c');
  await waitFor(() => attaches(fake.received).length >= 1);
  await new Promise((r) => setTimeout(r, 100));

  // A restore burst that hits the daemon all at once is exactly what overflows
  // its outbox and costs every session its replay.
  assert.deepEqual(attaches(fake.received), ['a'], 'only the first attach is in flight');

  fake.ack('a');
  await waitFor(() => attaches(fake.received).length === 2);
  assert.deepEqual(attaches(fake.received), ['a', 'b']);

  fake.ack('b');
  await waitFor(() => attaches(fake.received).length === 3);
  assert.deepEqual(attaches(fake.received), ['a', 'b', 'c']);

  client.dispose();
  fake.close();
});

test('DaemonClient: an unacked attach releases the queue after the ack timeout', async () => {
  const fake = fakeDaemon();
  await fake.listening;
  // A daemon too old to ack (the running one, until it is restarted) must not
  // wedge the restore: the queue advances on a timeout.
  const client = new DaemonClient(fake.socketPath, '/nonexistent', 'test', { attachAckTimeoutMs: 150 });
  await client.ensureConnected();

  client.attach('a');
  client.attach('b');
  await waitFor(() => attaches(fake.received).length === 2, 3000);
  assert.deepEqual(attaches(fake.received), ['a', 'b']);

  client.dispose();
  fake.close();
});

test('DaemonClient: the pre-attach hook runs when the attach is sent, not when queued', async () => {
  const fake = fakeDaemon();
  await fake.listening;
  const client = new DaemonClient(fake.socketPath, '/nonexistent', 'test');
  await client.ensureConnected();

  const ran: string[] = [];
  client.attach('a', () => ran.push('a'));
  client.attach('b', () => ran.push('b'));
  await waitFor(() => ran.length >= 1);
  await new Promise((r) => setTimeout(r, 100));

  // The hook wipes the session's mirror so the replay lands in a clean buffer.
  // Wiping every mirror up front would blank sessions that are still minutes
  // away from their turn in the queue.
  assert.deepEqual(ran, ['a']);
  fake.ack('a');
  await waitFor(() => ran.length === 2);
  assert.deepEqual(ran, ['a', 'b']);

  client.dispose();
  fake.close();
});

test('DaemonClient: connecting to a daemon that closes without a hello fails instead of hanging', async () => {
  const fake = fakeDaemon({ closeWithoutHello: true });
  await fake.listening;
  // A daemon already serving another consumer accepts then closes. Waiting for
  // a hello that will never come left ensureConnected pending forever, and with
  // it every caller awaiting backend.ready().
  const client = new DaemonClient(fake.socketPath, '/usr/bin/true', 'test');
  const outcome = await Promise.race([
    client.ensureConnected().then(() => 'connected').catch(() => 'rejected'),
    new Promise((r) => setTimeout(() => r('hung'), 6000)),
  ]);
  assert.equal(outcome, 'rejected');

  client.dispose();
  fake.close();
});

test('DaemonClient: a restore burst replays every session\'s backlog', { ...(guard ?? {}), timeout: 120_000 }, async () => {
  const { socketPath, cleanup } = shortSocket();
  const ids = ['s0', 's1', 's2', 's3', 's4', 's5'];

  // Fill each session's 2MB ring: six of them are several times the daemon's
  // 8MB outbox, which is what used to make the whole restore burst collapse.
  const c1 = new DaemonClient(socketPath, BIN!, 'test');
  await c1.ensureConnected();
  const seen: Record<string, number> = {};
  for (const id of ids) {
    const pty = new DaemonPty(c1, id);
    pty.onData((d) => { seen[id] = (seen[id] ?? 0) + d.length; });
    c1.spawn(id, ['/bin/sh', '-c', 'head -c 2500000 /dev/urandom | base64; sleep 60'], os.tmpdir(), {}, 135, 72);
  }
  await waitFor(() => ids.every((id) => (seen[id] ?? 0) >= 2_400_000), 60_000);
  c1.dispose();
  await new Promise((r) => setTimeout(r, 200));

  const c2 = new DaemonClient(socketPath, BIN!, 'test');
  await c2.ensureConnected();
  const replayed: Record<string, number> = {};
  for (const id of ids) {
    const pty = new DaemonPty(c2, id);
    pty.onData((d) => { replayed[id] = (replayed[id] ?? 0) + d.length; });
  }
  for (const id of ids) c2.attach(id);

  await waitFor(() => ids.every((id) => (replayed[id] ?? 0) >= 2_000_000), 90_000);
  for (const id of ids) {
    assert.ok((replayed[id] ?? 0) >= 2_000_000, `${id} replayed only ${replayed[id] ?? 0} bytes`);
  }

  c2.killAll();
  c2.dispose();
  cleanup();
});
