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
import { activityFromPayload, ACTIVITY_PAYLOAD_CAP } from '../activity/activitySummary.js';
import type { SessionManager } from '../SessionManager.js';

/**
 * End to end for `argus-signal --activity`: the real script and route. The hook
 * must print nothing and exit 0, and forward at most the capped head.
 */
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../resources/bin/argus-signal');
const SECRET = 'activity-secret';
const SESSION = 'sess-activity';
const TOKEN = computeSignalToken(SECRET, SESSION);

const received: string[] = [];
let server: Server;
let base: string;

function run(stdin: string, env: Record<string, string>): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(SCRIPT, ['--session', SESSION, '--activity'], { env: { ...process.env, ...env } });
    let stdout = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
    child.on('close', (code) => resolve({ code, stdout }));
  });
}

before(async () => {
  const manager = { recordActivityHook: (_id: string, raw: string) => received.push(raw) } as unknown as SessionManager;
  const app = express();
  app.use('/api/agent-signals', createAgentSignalRoutes(manager, () => SECRET));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent-signals`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('forwards a capped head of a huge Write and prints nothing', async () => {
  received.length = 0;
  const payload = JSON.stringify({
    session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Write',
    tool_input: { file_path: '/repo/big.bin', content: 'Z'.repeat(2_000_000) },
  });
  const { code, stdout } = await run(payload, { ARGUS_SIGNAL_URL: base, ARGUS_SIGNAL_TOKEN: TOKEN });
  assert.equal(code, 0);
  assert.equal(stdout, '');
  assert.equal(received.length, 1);
  assert.ok(received[0]!.length <= ACTIVITY_PAYLOAD_CAP);
  assert.deepEqual(activityFromPayload(received[0]!), { type: 'tool', tool: 'Write', summary: '/repo/big.bin', filePath: '/repo/big.bin' });
});

test('silent and exit 0 with no server or no wiring', async () => {
  const a = await run('{"hook_event_name":"Stop"}', { ARGUS_SIGNAL_URL: 'http://127.0.0.1:9/x', ARGUS_SIGNAL_TOKEN: TOKEN });
  assert.deepEqual(a, { code: 0, stdout: '' });
  const b = await run('{"hook_event_name":"Stop"}', { ARGUS_SIGNAL_URL: '', ARGUS_SIGNAL_TOKEN: '' });
  assert.deepEqual(b, { code: 0, stdout: '' });
});
