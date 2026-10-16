import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';
import { createAgentSignalRoutes } from '../../routes/agentSignals.js';
import { computeSignalToken } from './token.js';
import type { SessionManager } from '../SessionManager.js';

/**
 * End to end for `argus-signal --statusline`: the real script and route. The
 * user's status line must come out byte for byte, the rate limits must reach
 * the server, and a slow or dead server must never delay the line.
 */
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../resources/bin/argus-signal');
const SECRET = 'statusline-secret';
const SESSION = 'sess-statusline';
const TOKEN = computeSignalToken(SECRET, SESSION);

const received: unknown[] = [];
let waiters: (() => void)[] = [];
let server: Server;
let base: string;
let slowServer: Server;
let slowBase: string;

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

function run(stdin: string, env: Record<string, string>): Promise<{ code: number | null; stdout: string; ms: number }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(SCRIPT, ['--session', SESSION, '--statusline'], {
      env: { ...process.env, ARGUS_SIGNAL_URL: '', ARGUS_SIGNAL_TOKEN: '', ARGUS_USER_STATUSLINE: '', ...env },
    });
    let stdout = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
    // 'exit', not 'close': the background sender must not hold the line open.
    child.on('exit', (code) => resolve({ code, stdout, ms: Date.now() - started }));
  });
}

function nextPost(timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), timeoutMs);
    waiters.push(() => { clearTimeout(t); resolve(true); });
  });
}

const STATUS = JSON.stringify({
  cwd: '/repo',
  model: { id: 'claude-opus-5-5', display_name: 'Opus' },
  rate_limits: {
    five_hour: { used_percentage: 23.5, resets_at: 1_800_003_600 },
    seven_day: { used_percentage: 41, resets_at: 1_800_300_000 },
  },
}, null, 2) + '\n';

before(async () => {
  const manager = {
    applyStatusLineRateLimits: (_id: string, rl: unknown) => {
      received.push(rl);
      const w = waiters;
      waiters = [];
      w.forEach((f) => f());
    },
  } as unknown as SessionManager;
  const app = express();
  app.use('/api/agent-signals', createAgentSignalRoutes(manager, () => SECRET));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent-signals`;
  // Accepts the connection and never answers.
  const slow = express();
  slow.use((_req, _res) => { /* hang */ });
  slowServer = await new Promise<Server>((resolve) => {
    const s = slow.listen(0, '127.0.0.1', () => resolve(s));
  });
  slowBase = `http://127.0.0.1:${(slowServer.address() as AddressInfo).port}/x`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  slowServer.closeAllConnections();
  await new Promise<void>((resolve) => slowServer.close(() => resolve()));
});

test("forwards the user's output unchanged, with the same stdin bytes and exit status", async () => {
  // The user's command sees the exact JSON (trailing newline included) and its
  // own output, trailing whitespace and all, comes back untouched.
  const cmd = 'cat; printf "  \\033[2mline two\\033[0m  \\n"; exit 3';
  const { code, stdout } = await run(STATUS, { ARGUS_USER_STATUSLINE: b64(cmd) });
  assert.equal(stdout, STATUS + '  \x1b[2mline two\x1b[0m  \n');
  assert.equal(code, 3);
});

test('prints nothing when the user has no status line', async () => {
  const { code, stdout } = await run(STATUS, { ARGUS_SIGNAL_URL: base, ARGUS_SIGNAL_TOKEN: TOKEN });
  assert.deepEqual({ code, stdout }, { code: 0, stdout: '' });
});

test('posts just the rate_limits object to the server', async () => {
  received.length = 0;
  const posted = nextPost();
  const { stdout } = await run(STATUS, { ARGUS_SIGNAL_URL: base, ARGUS_SIGNAL_TOKEN: TOKEN, ARGUS_USER_STATUSLINE: b64('echo ok') });
  assert.equal(stdout, 'ok\n');
  assert.equal(await posted, true, 'the background post arrived');
  assert.deepEqual(received[0], {
    five_hour: { used_percentage: 23.5, resets_at: 1_800_003_600 },
    seven_day: { used_percentage: 41, resets_at: 1_800_300_000 },
  });
});

test('never slow: a hung server does not delay the line', async () => {
  const { stdout, ms } = await run(STATUS, { ARGUS_SIGNAL_URL: slowBase, ARGUS_SIGNAL_TOKEN: TOKEN, ARGUS_USER_STATUSLINE: b64('echo fast') });
  assert.equal(stdout, 'fast\n');
  assert.ok(ms < 700, `returned in ${ms}ms (the post times out at 1s in the background)`);
});

test('malformed stdin: user line still runs, nothing is posted, exit 0', async () => {
  received.length = 0;
  for (const junk of ['', '{not json', '{"rate_limits": {"five_hour": {"used_percentage": 5', '\x00\x01binary']) {
    const { code, stdout } = await run(junk, { ARGUS_SIGNAL_URL: base, ARGUS_SIGNAL_TOKEN: TOKEN, ARGUS_USER_STATUSLINE: b64('printf user') });
    assert.equal(code, 0);
    assert.equal(stdout, 'user');
  }
  // No rate limits key at all, or a truncated object: nothing to forward.
  assert.equal(await nextPost(500), false);
  assert.equal(received.length, 0);
});

test('rejects a bad token and ignores non-JSON bodies at the route', async () => {
  received.length = 0;
  const bad = await fetch(`${base}/${SESSION}/statusline`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'nope\n{}' });
  assert.equal(bad.status, 401);
  const junk = await fetch(`${base}/${SESSION}/statusline`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: `${TOKEN}\n{oops` });
  assert.equal(junk.status, 204);
  assert.equal(received.length, 0);
});
