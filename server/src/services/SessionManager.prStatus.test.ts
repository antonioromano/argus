import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import type { SessionPr } from '@argus/shared';
import { SessionManager, SESSION_PRS_MAX } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

// The PR/CI sweep: one lookup per folder per tick, `session:pr` only on change,
// and switching the feature off clears every chip.

const PR: SessionPr = { number: 7, state: 'open', url: 'https://github.com/o/r/pull/7', ci: 'pending', branch: 'feat/a' };

function fixture() {
  const configStore = { load: async () => ({}), save: async () => {} } as any;
  const sm = new SessionManager(os.tmpdir(), configStore);
  const emitted: Array<{ event: string; payload: any }> = [];
  (sm as any).io = {
    to: () => ({ emit: () => {} }),
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  };
  const folder = path.resolve(os.tmpdir());
  for (const id of ['a', 'b']) {
    (sm as any).sessions.set(id, {
      id, name: id, folderPath: folder, agentType: 'claude', flags: [],
      status: 'idle', createdAt: new Date().toISOString(),
    });
  }
  const lookups: string[] = [];
  let answer: SessionPr | null = PR;
  // Set the service directly: setPrStatusService would also arm the interval.
  const urlLookups: string[] = [];
  (sm as any).prService = {
    forFolder: async (f: string) => { lookups.push(f); return answer; },
    forUrl: async (url: string) => { urlLookups.push(url); return { ...PR, number: 99, url, branch: 'feat/other' }; },
    clear: () => {},
  };
  const linkPr = (id: string, url: string | undefined) => {
    (sm as any).sessions.get(id).usage = { linkedPrUrl: () => url, snapshot: () => undefined };
  };
  return { sm, emitted, lookups, urlLookups, linkPr, folder, setAnswer: (a: SessionPr | null) => { answer = a; } };
}

const prEvents = (emitted: Array<{ event: string; payload: any }>) => emitted.filter((e) => e.event === 'session:pr');

test('sessions sharing a folder share one lookup; each gets the chip', async () => {
  const f = fixture();
  await f.sm.pollPrStatus();
  assert.deepEqual(f.lookups, [f.folder]);
  assert.deepEqual(prEvents(f.emitted).map((e) => e.payload), [
    { sessionId: 'a', pr: PR },
    { sessionId: 'b', pr: PR },
  ]);
  assert.deepEqual(f.sm.getSessionInfo('a')?.pr, PR);
});

test('an unchanged answer is not re-broadcast; a changed one is', async () => {
  const f = fixture();
  await f.sm.pollPrStatus();
  await f.sm.pollPrStatus();
  assert.equal(prEvents(f.emitted).length, 2);
  f.setAnswer({ ...PR, ci: 'success' });
  await f.sm.pollPrStatus();
  assert.equal(prEvents(f.emitted).length, 4);
  f.setAnswer(null);
  await f.sm.pollPrStatus();
  assert.deepEqual(prEvents(f.emitted).slice(4).map((e) => e.payload.pr), [null, null]);
  assert.equal(f.sm.getSessionInfo('a')?.pr, undefined);
});

test('turning the setting off clears chips and stops lookups', async () => {
  const f = fixture();
  await f.sm.pollPrStatus();
  f.sm.setPrStatusEnabled(false);
  assert.deepEqual(prEvents(f.emitted).slice(2).map((e) => e.payload), [
    { sessionId: 'a', pr: null },
    { sessionId: 'b', pr: null },
  ]);
  await f.sm.pollPrStatus();
  assert.equal(f.lookups.length, 1);
});

test('no PR on the folder branch: the PR the transcript links is shown instead', async () => {
  const f = fixture();
  f.setAnswer(null);
  const url = 'https://github.com/o/other/pull/99';
  f.linkPr('a', url);
  await f.sm.pollPrStatus();
  assert.deepEqual(f.urlLookups, [url]);
  assert.equal(f.sm.getSessionInfo('a')?.pr?.url, url);
  assert.equal(f.sm.getSessionInfo('b')?.pr, undefined);
});

test('the folder branch PR wins over a transcript-linked one', async () => {
  const f = fixture();
  f.linkPr('a', 'https://github.com/o/other/pull/99');
  await f.sm.pollPrStatus();
  assert.deepEqual(f.urlLookups, []);
  assert.deepEqual(f.sm.getSessionInfo('a')?.pr, PR);
});

// ── B3: every PR of a session (Inspector GitHub card) ─────────────────────

function linkPrs(f: ReturnType<typeof fixture>, id: string, urls: string[]): void {
  (f.sm as any).sessions.get(id).usage = { linkedPrUrl: () => urls[urls.length - 1], linkedPrUrls: () => urls, snapshot: () => undefined };
}

test('listSessionPrs: linked PRs newest first, the folder PR marked and not looked up twice', async () => {
  const f = fixture();
  const other = 'https://github.com/o/other/pull/3';
  linkPrs(f, 'a', [other, PR.url, 'https://github.com/o/r/pull/12']);
  const res = await f.sm.listSessionPrs('a');
  assert.equal(res?.enabled, true);
  assert.deepEqual(res?.prs.map((e) => [e.url, e.folderBranch, e.linked]), [
    ['https://github.com/o/r/pull/12', false, true],
    [PR.url, true, true],
    [other, false, true],
  ]);
  assert.deepEqual(res?.prs[1].pr, PR, 'the folder PR keeps its branch lookup');
  assert.equal(res?.prs[0].pr?.number, 99);
  assert.deepEqual(f.urlLookups.sort(), [other, 'https://github.com/o/r/pull/12'].sort(), 'no forUrl for the folder PR');
});

test('listSessionPrs: a folder PR the conversation never linked goes on top', async () => {
  const f = fixture();
  linkPrs(f, 'a', ['https://github.com/o/r/pull/1']);
  const res = await f.sm.listSessionPrs('a');
  assert.deepEqual(res?.prs.map((e) => [e.url, e.folderBranch, e.linked]), [
    [PR.url, true, false],
    ['https://github.com/o/r/pull/1', false, true],
  ]);
});

test('listSessionPrs: nothing linked and no folder PR → empty; unknown session → null; off → disabled', async () => {
  const f = fixture();
  f.setAnswer(null);
  assert.deepEqual(await f.sm.listSessionPrs('a'), { enabled: true, prs: [] });
  assert.equal(await f.sm.listSessionPrs('nope'), null);
  f.sm.setPrStatusEnabled(false);
  assert.deepEqual(await f.sm.listSessionPrs('a'), { enabled: false, prs: [] });
  assert.equal(f.lookups.length, 1, 'no lookups while the feature is off');
});

test('listSessionPrs: reads at most SESSION_PRS_MAX PRs, the newest', async () => {
  const f = fixture();
  f.setAnswer(null);
  const urls = Array.from({ length: SESSION_PRS_MAX + 5 }, (_, i) => `https://github.com/o/r/pull/${i + 1}`);
  linkPrs(f, 'a', urls);
  const res = await f.sm.listSessionPrs('a');
  assert.equal(res?.prs.length, SESSION_PRS_MAX);
  assert.equal(res?.prs[0].url, urls[urls.length - 1]);
  assert.equal(f.urlLookups.length, SESSION_PRS_MAX);
});
