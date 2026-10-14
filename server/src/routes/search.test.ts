import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { SearchResponse } from '@argus/shared';
import { createSearchRoutes } from './search.js';
import type { SearchTarget } from '../services/search/crossSessionSearch.js';
import { getRipgrepPath } from '../utils/ripgrep.js';

let dir: string;
let transcript: string;
let server: Server;
let base: string;
let targets: SearchTarget[] = [];
let rg: string | null = null;

const target = (id: string, sb: ReturnType<SearchTarget['scrollback']>, transcripts: string[] = []): SearchTarget => ({
  sessionId: id,
  sessionName: `name-${id}`,
  agentType: 'claude',
  scrollback: () => sb,
  transcripts: () => transcripts,
});

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'argus-search-test-'));
  transcript = join(dir, 'conv.jsonl');
  await writeFile(transcript, [
    JSON.stringify({ type: 'user', message: { content: 'please deploy the widget' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', input: { cmd: 'widget' } }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'The Widget is deployed' }] } }),
  ].join('\n') + '\n');
  rg = getRipgrepPath();
  const app = express();
  app.use('/search', createSearchRoutes({ targets: () => targets, rgPath: () => rg }));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/search`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

async function search(params: Record<string, string>) {
  const res = await fetch(`${base}?${new URLSearchParams(params)}`);
  return { status: res.status, body: (await res.json()) as SearchResponse & { error?: string } };
}

test('rejects a missing, too-short, too-long or multi-line query', async () => {
  targets = [];
  for (const q of ['', 'a', 'x'.repeat(201), 'two\nlines']) {
    assert.equal((await search({ q })).status, 400, JSON.stringify(q));
  }
});

test('groups hits by session; live hits carry a row, frozen ones do not; no-hit sessions are dropped', async () => {
  targets = [
    target('live', { kind: 'live', rows: [{ text: 'npm ERR! widget' }, { text: 'ok' }] }),
    target('asleep', { kind: 'frozen', frame: 'boot\r\n\x1b[32mWIDGET\x1b[0m ready\r\n' }),
    target('none', null),
    target('miss', { kind: 'live', rows: [{ text: 'nothing here' }] }),
  ];
  const { status, body } = await search({ q: 'widget' });
  assert.equal(status, 200);
  assert.deepEqual(body.results.map((r) => [r.sessionId, r.scrollback]), [['live', 'live'], ['asleep', 'frozen']]);
  assert.equal(body.results[0]!.hits[0]!.line, 0);
  assert.equal(body.results[0]!.sessionName, 'name-live');
  assert.equal(body.results[1]!.hits[0]!.line, undefined);
  assert.equal(body.results[1]!.hits[0]!.snippet, 'WIDGET ready');
  assert.equal(body.truncated, false);
});

test('caps the total number of hits at limit and flags truncation', async () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ text: `widget ${i}` }));
  targets = [target('a', { kind: 'live', rows }), target('b', { kind: 'live', rows })];
  const { body } = await search({ q: 'widget', limit: '25' });
  const total = body.results.reduce((n, r) => n + r.hits.length, 0);
  assert.equal(total, 25);
  assert.equal(body.truncated, true);
  assert.equal(body.results[0]!.hits.length, 20, 'per-session cap');
});

test('searches transcripts with ripgrep and keeps only message-text matches, newest first', async (t) => {
  if (!rg) {
    t.skip('ripgrep unavailable');
    return;
  }
  targets = [target('claude', null, [transcript])];
  const { body } = await search({ q: 'widget' });
  assert.equal(body.results.length, 1);
  const hits = body.results[0]!.hits;
  assert.deepEqual(hits.map((h) => [h.source, h.role, h.snippet]), [
    ['transcript', 'assistant', 'The Widget is deployed'],
    ['transcript', 'user', 'please deploy the widget'],
  ]);
});

test('without ripgrep, transcripts are skipped rather than failing', async () => {
  const app = express();
  app.use('/s', createSearchRoutes({ targets: () => [target('claude', null, [transcript])], rgPath: () => null }));
  const s = await new Promise<Server>((resolve) => {
    const srv = app.listen(0, () => resolve(srv));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/s?q=widget`);
    assert.deepEqual(((await res.json()) as SearchResponse).results, []);
  } finally {
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});
