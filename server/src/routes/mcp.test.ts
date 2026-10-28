import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createMcpRoutes } from './mcp.js';
import { computeMcpToken } from '../services/mcp/injection.js';
import { computeSignalToken } from '../services/agentSignals/token.js';
import { ToolError, textResult, type ToolDef } from '../services/mcp/protocol.js';
import type { McpCaller } from '../services/mcp/tools.js';

const SECRET = 'mcp-test-secret';
const LIVE = 'sess-live';
let enabled = true;
let release: (() => void) | undefined;
const tools: ToolDef<McpCaller>[] = [
  { name: 'whoami', title: '', description: '', inputSchema: {}, run: async (_a, c) => textResult(c.name) },
  { name: 'slow', title: '', description: '', inputSchema: {}, run: () => new Promise((r) => { release = () => r(textResult('done')); }) },
  { name: 'deny', title: '', description: '', inputSchema: {}, run: async () => { throw new ToolError('no'); } },
];

let server: Server;
let url: string;
before(async () => {
  const app = express();
  app.use('/mcp', createMcpRoutes({
    isEnabled: () => enabled,
    getSecret: () => SECRET,
    caller: (id) => (id === LIVE || id === 'sess-other' ? { sessionId: id, name: `name-of-${id}` } : undefined),
    tools,
    keepAliveMs: 10,
  }));
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
after(async () => { await new Promise<void>((r) => server.close(() => r())); });

const auth = (id = LIVE, token = computeMcpToken(SECRET, id)) => ({ authorization: `Bearer ${token}`, 'x-argus-session': id });
const rpc = (body: unknown, headers: Record<string, string> = auth()) => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
  body: JSON.stringify(body),
});
const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } };

test('a valid session token initializes', async () => {
  const res = await rpc(initialize);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).result.serverInfo.name, 'argus');
});

test('missing, forged, cross-session and signal tokens are rejected', async () => {
  assert.equal((await rpc(initialize, {})).status, 401);
  assert.equal((await rpc(initialize, auth(LIVE, 'f'.repeat(64)))).status, 401);
  assert.equal((await rpc(initialize, auth(LIVE, computeMcpToken(SECRET, 'sess-other')))).status, 401, 'token of another session');
  assert.equal((await rpc(initialize, auth(LIVE, computeSignalToken(SECRET, LIVE)))).status, 401, 'agent-signal token');
  assert.equal((await rpc(initialize, auth('sess-gone'))).status, 401, 'valid HMAC but no such session');
});

test('browser and tunnelled requests are refused before auth', async () => {
  assert.equal((await rpc(initialize, { ...auth(), origin: 'https://evil.example' })).status, 403);
  assert.equal((await rpc(initialize, { ...auth(), 'x-forwarded-for': '1.2.3.4' })).status, 403);
});

test('disabled setting → 404 for every method', async () => {
  enabled = false;
  try {
    assert.equal((await rpc(initialize)).status, 404);
    assert.equal((await fetch(url)).status, 404);
  } finally { enabled = true; }
});

test('GET is 405 (stateless server, no stream to open); notifications are 202', async () => {
  const get = await fetch(url, { headers: auth() });
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
  assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
});

test('tools/call streams SSE with keep-alives until the tool finishes', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'slow' } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  await new Promise((r) => setTimeout(r, 40));
  release!();
  const body = await res.text();
  assert.match(body, /^: keep-alive/m);
  const data = body.split('\n').find((l) => l.startsWith('data: '))!;
  assert.equal(JSON.parse(data.slice(6)).result.content[0].text, 'done');
});

test('tools/call without SSE in Accept answers plain JSON, with the caller identity', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'whoami' } }, { ...auth(), accept: 'application/json' });
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.equal((await res.json()).result.content[0].text, `name-of-${LIVE}`);
  const denied = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'deny' } }, { ...auth(), accept: 'application/json' });
  assert.equal((await denied.json()).result.isError, true);
});

test('a non-JSON body is a parse error', async () => {
  const res = await fetch(url, { method: 'POST', headers: { ...auth(), 'content-type': 'text/plain' }, body: 'hi' });
  assert.equal(res.status, 400);
});

test('malformed JSON is a JSON-RPC parse error; nothing is parsed before auth', async () => {
  const bad = await fetch(url, { method: 'POST', headers: { ...auth(), 'content-type': 'application/json' }, body: '{nope' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, -32700);
  const unauth = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
  assert.equal(unauth.status, 401);
});

test('a client that hangs up aborts the pending tool call', async () => {
  let aborted = false;
  tools.push({ name: 'wait', title: '', description: '', inputSchema: {}, run: (_a, c) => new Promise((r) => {
    c.signal?.addEventListener('abort', () => { aborted = true; r(textResult('x')); });
  }) });
  const ac = new AbortController();
  const res = await fetch(url, {
    method: 'POST', signal: ac.signal,
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...auth() },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'wait' } }),
  });
  assert.equal(res.status, 200);
  ac.abort();
  for (let i = 0; i < 50 && !aborted; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(aborted, true);
});
