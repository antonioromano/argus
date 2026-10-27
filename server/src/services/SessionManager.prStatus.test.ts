import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import type { SessionPr } from '@argus/shared';
import { SessionManager, SESSION_PRS_MAX } from './SessionManager.js';
import { PrDiffError, PrWriteError } from './PrStatusService.js';

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
  const diffs: Array<[string, string]> = [];
  let diffAnswer = (url: string): unknown => ({ url, diff: 'diff --git a/x b/x\n' });
  const readies: Array<[string, string, boolean]> = [];
  let readyAnswer = (): void => {};
  (sm as any).prService = {
    forFolder: async (f: string) => { lookups.push(f); return answer; },
    forUrl: async (url: string) => { urlLookups.push(url); return { ...PR, number: 99, url, branch: 'feat/other' }; },
    clear: () => {},
    prDiff: async (url: string, cwd: string) => { diffs.push([url, cwd]); return diffAnswer(url); },
    setReady: async (url: string, cwd: string, ready: boolean) => { readies.push([url, cwd, ready]); readyAnswer(); },
  };
  const linkPr = (id: string, url: string | undefined) => {
    (sm as any).sessions.get(id).usage = { linkedPrUrl: () => url, linkedPrUrls: () => (url ? [url] : []), snapshot: () => undefined };
  };
  return {
    sm, emitted, lookups, urlLookups, linkPr, folder, diffs, readies,
    setReady: (fn: () => void) => { readyAnswer = fn; },
    setAnswer: (a: SessionPr | null) => { answer = a; },
    setDiff: (fn: (url: string) => unknown) => { diffAnswer = fn; },
  };
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
  const url = 'https://github.com/o/other/pull/99';
  f.linkPr('a', url);
  await f.sm.pollPrStatus();
  // Read once, for the summary only.
  assert.deepEqual(f.urlLookups, [url]);
  assert.deepEqual(f.sm.getSessionInfo('a')?.pr, PR);
});

// ── F5: the shell tab's PR summary ──────────────────────────────────────────

const summaryEvents = (emitted: Array<{ event: string; payload: any }>) => emitted.filter((e) => e.event === 'session:prSummary');

test('the sweep summarizes every PR of the session; the fallback PR is read once', async () => {
  const f = fixture();
  f.setAnswer(null);
  const urls = ['https://github.com/o/r/pull/1', 'https://github.com/o/r/pull/2'];
  linkPrs(f, 'a', urls);
  await f.sm.pollPrStatus();
  assert.deepEqual(f.urlLookups.sort(), urls, 'pull/2 is both the chip and a summary entry, read once');
  const summary = f.sm.getSessionInfo('a')?.prSummary;
  assert.equal(summary?.count, 2);
  assert.equal(summary?.tone, 'pending');
  assert.deepEqual(summary?.prs.map((p) => p.url), [urls[1], urls[0]], 'newest first');
  assert.equal(f.sm.getSessionInfo('b')?.prSummary, undefined);
  assert.deepEqual(summaryEvents(f.emitted).map((e) => e.payload.sessionId), ['a']);
});

test('the summary is broadcast only when it changes, and cleared when the setting goes off', async () => {
  const f = fixture();
  await f.sm.pollPrStatus();
  await f.sm.pollPrStatus();
  assert.deepEqual(summaryEvents(f.emitted).map((e) => e.payload.summary?.count), [1, 1]);
  f.setAnswer({ ...PR, state: 'merged' });
  await f.sm.pollPrStatus();
  assert.deepEqual(summaryEvents(f.emitted).slice(2).map((e) => e.payload.summary?.tone), ['merged', 'merged']);
  f.sm.setPrStatusEnabled(false);
  assert.deepEqual(summaryEvents(f.emitted).slice(4).map((e) => e.payload), [
    { sessionId: 'a', summary: null },
    { sessionId: 'b', summary: null },
  ]);
  assert.equal(f.sm.getSessionInfo('a')?.prSummary, undefined);
});

test('a session whose PRs are all closed has no summary', async () => {
  const f = fixture();
  f.setAnswer({ ...PR, state: 'closed' });
  await f.sm.pollPrStatus();
  assert.equal(f.sm.getSessionInfo('a')?.pr?.state, 'closed');
  assert.equal(f.sm.getSessionInfo('a')?.prSummary, undefined);
  assert.equal(summaryEvents(f.emitted).length, 0);
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

test('listSessionPrs: a folder PR linked long ago stays in the capped list, marked linked', async () => {
  const f = fixture();
  const urls = [PR.url, ...Array.from({ length: SESSION_PRS_MAX + 2 }, (_, i) => `https://github.com/o/r/pull/${100 + i}`)];
  linkPrs(f, 'a', urls);
  const res = await f.sm.listSessionPrs('a');
  assert.equal(res?.prs.length, SESSION_PRS_MAX);
  const last = res!.prs[SESSION_PRS_MAX - 1];
  assert.deepEqual([last.url, last.folderBranch, last.linked], [PR.url, true, true]);
  assert.equal(f.urlLookups.includes(PR.url), false);
});

test('listSessionPrs: the folder PR matches a pr-link spelled with another case', async () => {
  const f = fixture();
  linkPrs(f, 'a', ['https://github.com/O/R/pull/7']);
  const res = await f.sm.listSessionPrs('a');
  assert.equal(res?.prs.length, 1);
  assert.equal(res?.prs[0].folderBranch, true);
  assert.deepEqual(f.urlLookups, []);
});

test('a change the chip does not render (title, mergeable) is stored but not broadcast', async () => {
  const f = fixture();
  await f.sm.pollPrStatus();
  f.setAnswer({ ...PR, title: 'New title', mergeable: 'mergeable' });
  await f.sm.pollPrStatus();
  assert.equal(prEvents(f.emitted).length, 2);
  assert.equal(f.sm.getSessionInfo('a')?.pr?.title, 'New title');
});

// ── B4: one PR's diff ───────────────────────────────────────────────────────

test('sessionPrDiff: a linked PR, matched case-insensitively, is read by the list\'s URL in the folder', async () => {
  const f = fixture();
  const linked = 'https://github.com/o/other/pull/3';
  linkPrs(f, 'a', [linked]);
  const res = await f.sm.sessionPrDiff('a', 'https://github.com/O/Other/pull/3');
  assert.deepEqual(res, { ok: true, diff: { url: linked, diff: 'diff --git a/x b/x\n' } });
  assert.deepEqual(f.diffs, [[linked, f.folder]]);
  assert.deepEqual(f.urlLookups, [], 'no status lookups just to authorize a diff');
  assert.deepEqual(f.lookups, [], 'a recent linked PR needs no folder lookup either');
});

test('sessionPrDiff: the folder branch PR is allowed even when never linked', async () => {
  const f = fixture();
  const res = await f.sm.sessionPrDiff('a', PR.url);
  assert.equal(res.ok, true);
  assert.deepEqual(f.diffs, [[PR.url, f.folder]]);
});

test('sessionPrDiff: a PR outside the session list, an unknown session or the feature off → refused, gh never runs', async () => {
  const f = fixture();
  linkPrs(f, 'a', ['https://github.com/o/r/pull/1']);
  assert.deepEqual(await f.sm.sessionPrDiff('a', 'https://github.com/o/r/pull/2'), { ok: false, status: 404, error: 'Not a pull request of this session' });
  assert.equal((await f.sm.sessionPrDiff('nope', PR.url)).ok, false);
  f.sm.setPrStatusEnabled(false);
  assert.deepEqual(await f.sm.sessionPrDiff('a', PR.url), { ok: false, status: 409, error: 'Pull request status is off' });
  assert.deepEqual(f.diffs, []);
});

test('sessionPrDiff: a session folder outside every managed root says so', async () => {
  const f = fixture();
  (f.sm as any).resolveWithinAnySession = () => null;
  assert.deepEqual(await f.sm.sessionPrDiff('a', PR.url), { ok: false, status: 404, error: 'The session folder is not available' });
  assert.deepEqual(f.diffs, []);
});

test('sessionPrDiff: a PR beyond the capped list is refused', async () => {
  const f = fixture();
  f.setAnswer(null);
  const urls = Array.from({ length: SESSION_PRS_MAX + 1 }, (_, i) => `https://github.com/o/r/pull/${i + 1}`);
  linkPrs(f, 'a', urls);
  assert.equal((await f.sm.sessionPrDiff('a', urls[0])).ok, false, 'the oldest fell off the list');
  assert.equal((await f.sm.sessionPrDiff('a', urls[1])).ok, true);
});

test('sessionPrDiff: gh errors map to 503 / 504 / 502', async () => {
  const f = fixture();
  for (const [kind, status] of [['unavailable', 503], ['timeout', 504], ['failed', 502]] as const) {
    f.setDiff(() => { throw new PrDiffError(kind, `gh ${kind}`); });
    assert.deepEqual(await f.sm.sessionPrDiff('a', PR.url), { ok: false, status, error: `gh ${kind}` });
  }
});

// ── C3: Mark ready ──────────────────────────────────────────────────────────

test('setSessionPrReady: runs on the list\'s spelling of a session PR, in the folder, and answers it read again', async () => {
  const f = fixture();
  const linked = 'https://github.com/o/other/pull/3';
  linkPrs(f, 'a', [linked]);
  const res = await f.sm.setSessionPrReady('a', 'https://github.com/O/Other/pull/3', true);
  assert.deepEqual(f.readies, [[linked, f.folder, true]]);
  assert.deepEqual(res, { ok: true, pr: { ...PR, number: 99, url: linked, branch: 'feat/other' } });
  await f.sm.setSessionPrReady('a', PR.url, false);
  assert.deepEqual(f.readies.at(-1), [PR.url, f.folder, false]);
});

test('setSessionPrReady: a PR outside the session list, an unknown session or the feature off → refused, gh never runs', async () => {
  const f = fixture();
  linkPrs(f, 'a', ['https://github.com/o/r/pull/1']);
  assert.deepEqual(await f.sm.setSessionPrReady('a', 'https://github.com/o/r/pull/2', true), { ok: false, status: 404, error: 'Not a pull request of this session' });
  assert.equal((await f.sm.setSessionPrReady('nope', PR.url, true)).ok, false);
  f.sm.setPrStatusEnabled(false);
  assert.deepEqual(await f.sm.setSessionPrReady('a', PR.url, true), { ok: false, status: 409, error: 'Pull request status is off' });
  assert.deepEqual(f.readies, []);
});

test('setSessionPrReady: gh errors map to 503 / 504 / 502', async () => {
  const f = fixture();
  for (const [kind, status] of [['unavailable', 503], ['timeout', 504], ['failed', 502]] as const) {
    f.setReady(() => { throw new PrWriteError(kind, `gh ${kind}`); });
    assert.deepEqual(await f.sm.setSessionPrReady('a', PR.url, true), { ok: false, status, error: `gh ${kind}` });
  }
});

test('setSessionPrReady: a sweep running during the write is followed by one more', async () => {
  const f = fixture();
  let release!: () => void;
  let gate = true;
  (f.sm as any).prService.forFolder = async (folder: string) => {
    f.lookups.push(folder);
    if (gate) { gate = false; await new Promise<void>((r) => { release = r; }); }
    return PR;
  };
  const sweep = f.sm.pollPrStatus();
  await new Promise((r) => setImmediate(r));
  await f.sm.setSessionPrReady('a', PR.url, true);
  const before = f.lookups.length;
  release();
  await sweep;
  assert.ok(f.lookups.length > before, 'the chips were swept again after the running sweep');
});
