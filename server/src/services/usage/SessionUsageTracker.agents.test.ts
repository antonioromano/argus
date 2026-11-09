import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, appendFileSync, readFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AgentRun } from '@argus/shared';
import { SessionUsageTracker } from './SessionUsageTracker.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'subagents');
const ID = 'aaaaaaaaaaaaaaaaa';

const user = (uuid: string, text: string) =>
  JSON.stringify({ type: 'user', uuid, message: { role: 'user', content: text } }) + '\n';

interface Call { agents: AgentRun[]; running: number }

function setup(agentsPollMs = 60_000) {
  const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'argus-agents-tracker-')));
  const conv = path.join(d, 'conv.jsonl');
  writeFileSync(conv, user('u1', 'hi'));
  const sub = path.join(d, 'conv', 'subagents');
  mkdirSync(sub, { recursive: true });
  for (const ext of ['meta.json', 'jsonl']) copyFileSync(path.join(FIXTURES, `agent-${ID}.${ext}`), path.join(sub, `agent-${ID}.${ext}`));
  const calls: Call[] = [];
  const t = new SessionUsageTracker(() => {}, {
    emitThrottleMs: 0,
    roots: [d],
    chatPollMs: 60_000,
    agentsPollMs,
    onAgents: (agents, running) => calls.push({ agents, running }),
  });
  const done = () => {
    t.dispose();
    rmSync(d, { recursive: true, force: true });
  };
  return { d, conv, sub, t, calls, done };
}

const finishMeta = (sub: string) => {
  const file = path.join(sub, `agent-${ID}.meta.json`);
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), finished: true }));
};

test('roster: setTranscript creates the roster next to the transcript and reports agents on pollNow', async () => {
  const { conv, t, calls, done } = setup();
  t.setTranscript(conv);
  await t.pollNow();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].running, 1);
  assert.deepEqual(calls[0].agents.map((a) => [a.id, a.status]), [[ID, 'running']]);
  assert.deepEqual(t.agentsSnapshot(), calls[0]);
  done();
});

test('roster: the roster timer runs only while an agent is unfinished', async () => {
  const { conv, sub, t, calls, done } = setup(20);
  t.setTranscript(conv);
  await t.pollNow();
  assert.equal(calls.at(-1)?.running, 1);
  finishMeta(sub);
  const deadline = Date.now() + 2000;
  while (calls.at(-1)?.running !== 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.at(-1)?.running, 0, 'the timer picked up the finished flag');
  assert.equal(calls.at(-1)?.agents[0].status, 'finished');
  const n = calls.length;
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(calls.length, n, 'no further reports once nothing is unfinished');
  done();
});

test('roster: a task notification in the transcript ends the agent', async () => {
  const { conv, t, calls, done } = setup();
  t.setTranscript(conv);
  await t.pollNow();
  appendFileSync(
    conv,
    JSON.stringify({
      type: 'user',
      uuid: 'u2',
      timestamp: '2026-11-09T14:40:00.000Z',
      message: { role: 'user', content: `<task-notification>\n<task-id>${ID}</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<status>completed</status>\n</task-notification>` },
    }) + '\n',
  );
  await t.pollNow();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].running, 0);
  assert.equal(calls[1].agents[0].status, 'finished');
  done();
});

test('roster: a transcript change fails the old roster', async () => {
  const { d, conv, t, calls, done } = setup();
  t.setTranscript(conv);
  await t.pollNow();
  const other = path.join(d, 'other.jsonl');
  writeFileSync(other, user('o1', 'new'));
  t.setTranscript(other);
  await t.pollNow();
  assert.equal(calls.length, 3);
  assert.equal(calls[1].running, 0);
  assert.deepEqual(calls[1].agents.map((a) => [a.id, a.status]), [[ID, 'failed']]);
  assert.deepEqual(calls[2], { agents: [], running: 0 });
  assert.deepEqual(t.agentsSnapshot(), { agents: [], running: 0 });
  done();
});

test('roster: a subagent transcript path is refused', async () => {
  const { conv, sub, t, done } = setup();
  t.setTranscript(conv);
  t.setTranscript(path.join(sub, `agent-${ID}.jsonl`));
  assert.equal(t.currentTranscript(), conv);
  done();
});

test('roster: failAgents emits failed and running 0', async () => {
  const { conv, t, calls, done } = setup();
  t.setTranscript(conv);
  await t.pollNow();
  t.failAgents();
  t.failAgents();
  assert.equal(calls.length, 2, 'emits once');
  assert.equal(calls[1].running, 0);
  assert.equal(calls[1].agents[0].status, 'failed');
  done();
});

test('roster: clearCurrent fails the unfinished agents first', async () => {
  const { conv, t, calls, done } = setup();
  t.setTranscript(conv);
  await t.pollNow();
  t.clearCurrent();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].running, 0);
  assert.equal(calls[1].agents[0].status, 'failed');
  done();
});
