import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import type { SessionPr } from '@argus/shared';
import { SessionManager } from './SessionManager.js';

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
