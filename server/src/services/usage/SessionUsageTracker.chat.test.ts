import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { SessionUsageTracker, type ChatSink } from './SessionUsageTracker.js';

type Update = Parameters<ChatSink>[0];

const user = (uuid: string, text: string) =>
  JSON.stringify({ type: 'user', uuid, message: { role: 'user', content: text } }) + '\n';

function setup() {
  const d = mkdtempSync(path.join(os.tmpdir(), 'argus-chat-tracker-'));
  const updates: Update[] = [];
  // A long safety-net poll so the tests drive every read explicitly.
  const t = new SessionUsageTracker(() => {}, { emitThrottleMs: 0, roots: [d], chatPollMs: 60_000 });
  const sink: ChatSink = (u) => updates.push(u);
  const done = () => {
    t.dispose();
    rmSync(d, { recursive: true, force: true });
  };
  return { d, t, updates, sink, done };
}

test('openChat before any transcript: unavailable, then a reset once one appears', async () => {
  const { d, t, updates, sink, done } = setup();
  await t.openChat(sink);
  assert.deepEqual(t.chatSnapshot(), { available: false, messages: [] });
  assert.equal(updates.length, 0);

  const a = path.join(d, 'a.jsonl');
  writeFileSync(a, user('u1', 'hi'));
  t.setTranscript(a);
  await t.pollNow();
  await t.openChat(sink); // second viewer: waits for the queued read
  assert.equal(updates.length, 1);
  assert.equal(updates[0].reset, true);
  assert.equal(updates[0].available, true);
  assert.deepEqual(updates[0].messages.map((m) => m.id), ['u1']);
  done();
});

test('the first read answers the snapshot, later lines go to the sink', async () => {
  const { d, t, updates, sink, done } = setup();
  const a = path.join(d, 'a.jsonl');
  writeFileSync(a, user('u1', 'one') + user('u2', 'two'));
  t.setTranscript(a);
  await t.openChat(sink);
  const snap = t.chatSnapshot();
  assert.equal(snap.available, true);
  assert.deepEqual(snap.messages.map((m) => m.id), ['u1', 'u2']);
  assert.equal(updates.length, 0, 'the initial history is not broadcast');

  appendFileSync(a, user('u3', 'three'));
  await t.pollNow();
  await t.openChat(sink);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].reset, false);
  assert.deepEqual(updates[0].messages.map((m) => m.id), ['u3']);
  done();
});

test('switching transcript (/clear, resume) resets the chat; clearCurrent makes it unavailable', async () => {
  const { d, t, updates, sink, done } = setup();
  const a = path.join(d, 'a.jsonl');
  const b = path.join(d, 'b.jsonl');
  writeFileSync(a, user('u1', 'old'));
  writeFileSync(b, user('n1', 'new'));
  t.setTranscript(a);
  await t.openChat(sink);
  t.setTranscript(b);
  await t.pollNow();
  await t.openChat(sink);
  assert.equal(updates.at(-1)?.reset, true);
  assert.deepEqual(updates.at(-1)?.messages.map((m) => m.id), ['n1']);

  t.clearCurrent();
  await t.openChat(sink);
  assert.deepEqual(updates.at(-1), { reset: true, available: false, messages: [] });
  done();
});

test('closeChat stops the feed and drops the messages', async () => {
  const { d, t, updates, sink, done } = setup();
  const a = path.join(d, 'a.jsonl');
  writeFileSync(a, user('u1', 'one'));
  t.setTranscript(a);
  await t.openChat(sink);
  t.closeChat();
  assert.deepEqual(t.chatSnapshot(), { available: false, messages: [] });
  appendFileSync(a, user('u2', 'two'));
  await t.pollNow();
  assert.equal(updates.length, 0);
  done();
});

test('the safety-net poll picks up lines written without a hook', async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'argus-chat-tracker-'));
  const updates: Update[] = [];
  const t = new SessionUsageTracker(() => {}, { emitThrottleMs: 0, roots: [d], chatPollMs: 20 });
  const a = path.join(d, 'a.jsonl');
  writeFileSync(a, user('u1', 'one'));
  t.setTranscript(a);
  await t.openChat((u) => updates.push(u));
  appendFileSync(a, user('u2', 'two'));
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(updates.flatMap((u) => u.messages.map((m) => m.id)), ['u2']);
  t.dispose();
  rmSync(d, { recursive: true, force: true });
});

test('the permission mode reaches the snapshot and the sink', async () => {
  const { d, t, updates, sink, done } = setup();
  const a = path.join(d, 'a.jsonl');
  const withMode = (uuid: string, mode: string) =>
    JSON.stringify({ type: 'user', uuid, permissionMode: mode, message: { role: 'user', content: uuid } }) + '\n';
  writeFileSync(a, withMode('u1', 'auto'));
  t.setTranscript(a);
  await t.openChat(sink);
  assert.equal(t.chatSnapshot().permissionMode, 'auto');
  appendFileSync(a, withMode('u2', 'acceptEdits'));
  await t.pollNow();
  await t.openChat(sink);
  assert.equal(updates.at(-1)?.permissionMode, 'acceptEdits');
  done();
});
