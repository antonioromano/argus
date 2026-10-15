import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createAgentSignalRoutes } from './agentSignals.js';
import { computeSignalToken } from '../services/agentSignals/token.js';
import type { SessionManager } from '../services/SessionManager.js';

const SECRET = 'test-secret-abc';
const calls: Array<{ id: string; sig: any }> = [];
const metas: Array<{ id: string; meta: any }> = [];
const activity: Array<{ id: string; raw: string }> = [];

const fakeManager = {
  applyNativeSignal: (id: string, sig: any) => {
    calls.push({ id, sig });
  },
  applyAgentMeta: (id: string, meta: any) => {
    metas.push({ id, meta });
  },
  recordActivityHook: (id: string, raw: string) => {
    activity.push({ id, raw });
  },
} as unknown as SessionManager;

let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.use('/api/agent-signals', createAgentSignalRoutes(fakeManager, () => SECRET));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api/agent-signals`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function post(sessionId: string, body: unknown): Promise<Response> {
  return fetch(`${base}/${sessionId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('valid token + state → 204 and forwards to applyNativeSignal', async () => {
  calls.length = 0;
  const token = computeSignalToken(SECRET, 'sess-1');
  const res = await post('sess-1', { token, state: 'waiting', promptText: 'Proceed?', coverage: ['running', 'waiting', 'idle'] });
  assert.equal(res.status, 204);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.id, 'sess-1');
  assert.equal(calls[0]!.sig.state, 'waiting');
  assert.equal(calls[0]!.sig.promptText, 'Proceed?');
  assert.deepEqual(calls[0]!.sig.coverage, ['running', 'waiting', 'idle']);
});

test('bad token → 401 and does not forward', async () => {
  calls.length = 0;
  const res = await post('sess-1', { token: 'wrong', state: 'idle' });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('token bound to another session is rejected (401)', async () => {
  calls.length = 0;
  const token = computeSignalToken(SECRET, 'sess-OTHER');
  const res = await post('sess-1', { token, state: 'idle' });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('invalid / missing state → 400', async () => {
  const token = computeSignalToken(SECRET, 'sess-1');
  assert.equal((await post('sess-1', { token, state: 'bogus' })).status, 400);
  assert.equal((await post('sess-1', { token })).status, 400);
});

test('invalid coverage entries are filtered out', async () => {
  calls.length = 0;
  const token = computeSignalToken(SECRET, 'sess-1');
  const res = await post('sess-1', { token, state: 'idle', coverage: ['idle', 'garbage', 'running'] });
  assert.equal(res.status, 204);
  assert.deepEqual(calls[0]!.sig.coverage, ['idle', 'running'], 'unknown coverage states dropped');
});

test('oversized body is rejected by the 16kb cap', async () => {
  const token = computeSignalToken(SECRET, 'sess-1');
  const huge = 'x'.repeat(32 * 1024);
  const res = await post('sess-1', { token, state: 'idle', promptText: huge });
  assert.equal(res.status, 413, 'payload too large');
});

const UUID = '0b0e7a3c-1f2d-4e5f-8a9b-0c1d2e3f4a5b';

test('hook metadata is forwarded alongside the state', async () => {
  calls.length = 0;
  metas.length = 0;
  const token = computeSignalToken(SECRET, 'sess-1');
  const res = await post('sess-1', { token, state: 'idle', claudeSessionId: UUID, transcriptPath: '/Users/u/.claude/projects/x/a.jsonl' });
  assert.equal(res.status, 204);
  assert.equal(calls.length, 1);
  assert.deepEqual(metas, [{ id: 'sess-1', meta: { claudeSessionId: UUID, transcriptPath: '/Users/u/.claude/projects/x/a.jsonl' } }]);
});

test('metadata-only post (no state) is accepted and applies no state', async () => {
  calls.length = 0;
  metas.length = 0;
  const token = computeSignalToken(SECRET, 'sess-1');
  const res = await post('sess-1', { token, claudeSessionId: UUID });
  assert.equal(res.status, 204);
  assert.equal(calls.length, 0);
  assert.equal(metas.length, 1);
});

test('malformed metadata is dropped, the state still applies', async () => {
  calls.length = 0;
  metas.length = 0;
  const token = computeSignalToken(SECRET, 'sess-1');
  const res = await post('sess-1', { token, state: 'running', claudeSessionId: '--dangerous; rm -rf', transcriptPath: '/etc/passwd' });
  assert.equal(res.status, 204);
  assert.equal(calls.length, 1);
  assert.equal(metas.length, 0);
  // With nothing valid left and no state, it is a bad request.
  assert.equal((await post('sess-1', { token, claudeSessionId: 'nope' })).status, 400);
});

test('metadata needs a valid token too', async () => {
  metas.length = 0;
  const res = await post('sess-1', { token: 'wrong', claudeSessionId: UUID });
  assert.equal(res.status, 401);
  assert.equal(metas.length, 0);
});

// --- F5 PreToolUse decision route -------------------------------------------

async function withDecider(
  decide: (id: string, hook: unknown) => object | null,
  fn: (url: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use('/api/agent-signals', createAgentSignalRoutes(fakeManager, () => SECRET, decide));
  const s = await new Promise<Server>((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  try {
    await fn(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/agent-signals`);
  } finally {
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
}

const ptu = (url: string, sessionId: string, body: unknown) =>
  fetch(`${url}/${sessionId}/pre-tool-use`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('pre-tool-use: allow → 200 with the decision JSON, passing session id and hook through', async () => {
  const seen: Array<{ id: string; hook: unknown }> = [];
  const allow = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'r' } };
  await withDecider((id, hook) => { seen.push({ id, hook }); return allow; }, async (url) => {
    const res = await ptu(url, 'sess-p', { token: computeSignalToken(SECRET, 'sess-p'), hook: { tool_name: 'Bash' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), allow);
    assert.deepEqual(seen, [{ id: 'sess-p', hook: { tool_name: 'Bash' } }]);
  });
});

test('pre-tool-use: no decision → 204 with an empty body', async () => {
  await withDecider(() => null, async (url) => {
    const res = await ptu(url, 'sess-p', { token: computeSignalToken(SECRET, 'sess-p'), hook: {} });
    assert.equal(res.status, 204);
    assert.equal(await res.text(), '');
  });
});

test('pre-tool-use: bad token → 401 and the decider never runs', async () => {
  let ran = false;
  await withDecider(() => { ran = true; return {}; }, async (url) => {
    const res = await ptu(url, 'sess-p', { token: computeSignalToken(SECRET, 'other'), hook: {} });
    assert.equal(res.status, 401);
    assert.equal(ran, false);
  });
});

test('pre-tool-use: a throwing decider → 204, not an error that could be misread', async () => {
  await withDecider(() => { throw new Error('boom'); }, async (url) => {
    const res = await ptu(url, 'sess-p', { token: computeSignalToken(SECRET, 'sess-p'), hook: {} });
    assert.equal(res.status, 204);
  });
});

test('pre-tool-use: without a decider wired → 204', async () => {
  const res = await ptu(base, 'sess-p', { token: computeSignalToken(SECRET, 'sess-p'), hook: {} });
  assert.equal(res.status, 204);
});

function postActivity(sessionId: string, text: string): Promise<Response> {
  return fetch(`${base}/${sessionId}/activity`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: text });
}

test('activity: token line + capped hook head → 204, forwards the payload after the token', async () => {
  activity.length = 0;
  const token = computeSignalToken(SECRET, 'sess-1');
  const head = '{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/a","content":"xx';
  const res = await postActivity('sess-1', `${token}\n${head}`);
  assert.equal(res.status, 204);
  assert.deepEqual(activity, [{ id: 'sess-1', raw: head }]);
});

test('activity: bad or missing token → 401, nothing recorded', async () => {
  activity.length = 0;
  assert.equal((await postActivity('sess-1', 'wrong\n{}')).status, 401);
  assert.equal((await postActivity('sess-1', computeSignalToken(SECRET, 'sess-1'))).status, 401);
  assert.equal(activity.length, 0);
});

test('activity: a body over the cap is refused (argus-signal sends at most 16 KB)', async () => {
  activity.length = 0;
  const token = computeSignalToken(SECRET, 'sess-1');
  const res = await postActivity('sess-1', `${token}\n${'x'.repeat(64 * 1024)}`);
  assert.equal(res.status, 413);
  assert.equal(activity.length, 0);
});
