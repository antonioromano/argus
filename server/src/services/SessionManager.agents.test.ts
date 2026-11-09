import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, symlinkSync, rmSync, statSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AgentRun, AgentSignalState } from '@argus/shared';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux'; // pin backend so a built argusd binary doesn't flip the default

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'usage', 'fixtures', 'subagents');
const ID = 'aaaaaaaaaaaaaaaaa';
const FULL: AgentSignalState[] = ['running', 'waiting', 'idle'];
const DONE_GRACE_MS = 2_000;

const fakeConfig = {
  load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
  save: async () => {},
} as any;

interface Emit { ev: string; p: any }

function mgr(roots?: string[]): { sm: SessionManager; emitted: Emit[] } {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const emitted: Emit[] = [];
  (sm as any).io = {
    emit: (ev: string, p: any) => emitted.push({ ev, p }),
    to: () => ({ emit: (ev: string, p: any) => emitted.push({ ev, p }) }),
    sockets: { adapter: { rooms: new Map() } },
  };
  (sm as any).refreshSleepPrevention = () => {};
  (sm as any).persistSessions = async () => {};
  if (roots) (sm as any).usageTrackerOpts = { roots, emitThrottleMs: 0, chatPollMs: 60_000, agentsPollMs: 60_000 };
  return { sm, emitted };
}

function inject(sm: SessionManager, over: Record<string, unknown> = {}): any {
  const s = {
    id: 's',
    name: 't',
    folderPath: os.tmpdir(),
    agentType: 'claude',
    flags: [],
    status: 'running',
    createdAt: new Date().toISOString(),
    pty: {},
    stateDetector: { getLastPromptText: () => '', resize: () => {}, getStatus: () => 'idle', msSinceLastFeed: () => Infinity, setExited: () => {} },
    outputBuffer: '',
    persistent: false,
    hasUserInputSinceIdle: true,
    ...over,
  };
  (sm as any).sessions.set('s', s);
  return s;
}

/** A transcript dir under a temp root with one running agent (the fixture). */
function transcriptDir() {
  const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'argus-sm-agents-')));
  const conv = path.join(d, 'conv.jsonl');
  writeFileSync(conv, JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'hi' } }) + '\n');
  const sub = path.join(d, 'conv', 'subagents');
  mkdirSync(sub, { recursive: true });
  for (const ext of ['meta.json', 'jsonl']) copyFileSync(path.join(FIXTURES, `agent-${ID}.${ext}`), path.join(sub, `agent-${ID}.${ext}`));
  return { d, conv, sub, done: () => rmSync(d, { recursive: true, force: true }) };
}

const agent = (status: AgentRun['status']): AgentRun => ({
  id: ID, agentType: 'general-purpose', description: 'x', background: true, depth: 1, startedAt: 1, status, outputTokens: 0,
});

/** What the roster reports, through the callback the manager gave its tracker. */
function report(sm: SessionManager, s: any, running: number): void {
  (sm as any).usageTracker(s).onAgents([agent(running > 0 ? 'running' : 'finished')], running);
}

const statuses = (emitted: Emit[]) => emitted.filter((e) => e.ev === 'session:status').map((e) => e.p.status);

test('agents: session:agents is emitted with the roster and running count, and SessionInfo carries both', async () => {
  const t = transcriptDir();
  const { sm, emitted } = mgr([t.d]);
  const s = inject(sm);
  sm.applyAgentMeta('s', { transcriptPath: t.conv });
  await s.usage.pollNow();
  const ev = emitted.filter((e) => e.ev === 'session:agents').at(-1);
  assert.ok(ev, 'session:agents emitted');
  assert.equal(ev.p.sessionId, 's');
  assert.equal(ev.p.agentsRunning, 1);
  assert.deepEqual(ev.p.agents.map((a: AgentRun) => [a.id, a.status]), [[ID, 'running']]);
  const info = sm.getSessionInfo('s')!;
  assert.equal(info.agentsRunning, 1);
  assert.deepEqual(info.agents?.map((a) => a.id), [ID]);
  s.usage.dispose();
  t.done();
});

test('agents: done promotion waits for agents (native idle)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sm, emitted } = mgr();
  const s = inject(sm);
  report(sm, s, 1);
  sm.applyNativeSignal('s', { state: 'idle', coverage: FULL });
  assert.equal(s.status, 'idle', 'the main turn ended: plain idle while an agent runs');
  t.mock.timers.tick(DONE_GRACE_MS * 3);
  assert.equal(s.status, 'idle');
  assert.ok(!statuses(emitted).includes('done'), 'no done while the agent runs');

  report(sm, s, 0);
  assert.equal(s.status, 'idle', 'the grace is honoured');
  t.mock.timers.tick(DONE_GRACE_MS);
  assert.equal(s.status, 'done');
  assert.equal(statuses(emitted).at(-1), 'done');
});

test('agents: done promotion waits for agents (heuristic idle)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sm, emitted } = mgr();
  const s = inject(sm);
  report(sm, s, 1);
  (sm as any).applyDetectedStatus('s', 'idle');
  t.mock.timers.tick(DONE_GRACE_MS * 3);
  assert.equal(s.status, 'idle');
  assert.ok(!statuses(emitted).includes('done'));
  report(sm, s, 0);
  t.mock.timers.tick(DONE_GRACE_MS);
  assert.equal(s.status, 'done');
});

test('agents: a pending grace re-arms instead of promoting while agents run', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sm } = mgr();
  const s = inject(sm);
  (sm as any).armDoneGrace(s);
  report(sm, s, 1);
  t.mock.timers.tick(DONE_GRACE_MS * 3);
  assert.equal(s.status, 'running');
  report(sm, s, 0);
  t.mock.timers.tick(DONE_GRACE_MS);
  assert.equal(s.status, 'done');
});

test('agents: no retry without user input since idle, or when the session was not running', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sm } = mgr();
  const s = inject(sm, { status: 'idle' });
  report(sm, s, 1);
  report(sm, s, 0);
  t.mock.timers.tick(DONE_GRACE_MS * 2);
  assert.equal(s.status, 'idle', 'idle that never held a done stays idle');

  const s2 = inject(sm, { status: 'running', hasUserInputSinceIdle: false });
  report(sm, s2, 1);
  sm.applyNativeSignal('s', { state: 'idle', coverage: FULL });
  report(sm, s2, 0);
  t.mock.timers.tick(DONE_GRACE_MS * 2);
  assert.equal(s2.status, 'idle');
});

test('agents: exit fails the roster', async () => {
  const t = transcriptDir();
  const { sm, emitted } = mgr([t.d]);
  const s = inject(sm);
  (sm as any).scheduleExitedTier = () => {};
  sm.applyAgentMeta('s', { transcriptPath: t.conv });
  await s.usage.pollNow();
  assert.equal(s.agentsRunning, 1);
  (sm as any).onPtyExit(s, s.stateDetector, 1);
  const ev = emitted.filter((e) => e.ev === 'session:agents').at(-1)!;
  assert.equal(ev.p.agentsRunning, 0);
  assert.deepEqual(ev.p.agents.map((a: AgentRun) => [a.id, a.status]), [[ID, 'failed']]);
  assert.equal(sm.getSessionInfo('s')!.agentsRunning, 0);
  s.usage.dispose();
  t.done();
});

test('agents: agentChat reads the agent transcript from an offset', async () => {
  const t = transcriptDir();
  const { sm } = mgr([t.d]);
  const s = inject(sm);
  sm.applyAgentMeta('s', { transcriptPath: t.conv });
  await s.usage.pollNow();
  const first = await sm.agentChat('s', ID, 0);
  assert.ok(first);
  assert.equal(first.available, true);
  assert.ok(first.messages.length > 0, 'the agent turns are messages');
  assert.equal(first.offset, statSync(path.join(t.sub, `agent-${ID}.jsonl`)).size);
  const next = await sm.agentChat('s', ID, first.offset);
  assert.deepEqual(next, { available: true, messages: [], offset: first.offset });
  s.usage.dispose();
  t.done();
});

test('agents: agentChat refuses a file outside the folder, and undefined for a missing agent', async () => {
  const t = transcriptDir();
  const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'argus-sm-outside-')));
  const OTHER = 'bbbbbbbbbbbbbbbb';
  copyFileSync(path.join(FIXTURES, `agent-${ID}.jsonl`), path.join(outside, 'secret.jsonl'));
  copyFileSync(path.join(FIXTURES, `agent-${ID}.meta.json`), path.join(t.sub, `agent-${OTHER}.meta.json`));
  symlinkSync(path.join(outside, 'secret.jsonl'), path.join(t.sub, `agent-${OTHER}.jsonl`));
  const { sm } = mgr([t.d]);
  const s = inject(sm);
  sm.applyAgentMeta('s', { transcriptPath: t.conv });
  await s.usage.pollNow();
  assert.ok(s.usage.agentsSnapshot().agents.some((a: AgentRun) => a.id === OTHER), 'the roster lists it');

  assert.deepEqual(await sm.agentChat('s', OTHER, 0), { available: false, messages: [], offset: 0 });
  assert.equal(await sm.agentChat('s', 'cccccccccccccccc', 0), undefined);
  assert.equal(await sm.agentChat('nope', ID, 0), undefined);
  s.usage.dispose();
  t.done();
  rmSync(outside, { recursive: true, force: true });
});
