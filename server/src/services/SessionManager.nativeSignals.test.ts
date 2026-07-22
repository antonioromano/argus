import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';
import type { AgentSignalState } from '@argus/shared';

const fakeConfig = {
  load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
  save: async () => {},
} as any;

const FULL: AgentSignalState[] = ['running', 'waiting', 'idle'];

interface Emit {
  ev: string;
  p: any;
}

function mgr(): { sm: SessionManager; emitted: Emit[] } {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const emitted: Emit[] = [];
  (sm as any).io = {
    emit: (ev: string, p: any) => emitted.push({ ev, p }),
    sockets: { adapter: { rooms: new Map() } },
  };
  (sm as any).refreshSleepPrevention = () => {};
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
    stateDetector: { getLastPromptText: () => 'SCRAPED', resize: () => {} },
    outputBuffer: '',
    persistent: false,
    hasUserInputSinceIdle: true,
    ...over,
  };
  (sm as any).sessions.set('s', s);
  return s;
}

const detect = (sm: SessionManager, st: string) => (sm as any).applyDetectedStatus('s', st);

test('arbiter: fresh native suppresses a covered heuristic transition (Claude, full coverage)', () => {
  const { sm, emitted } = mgr();
  const s = inject(sm, { agentType: 'claude', status: 'running', hasUserInputSinceIdle: false });
  sm.applyNativeSignal('s', { state: 'running', coverage: FULL });
  emitted.length = 0;

  detect(sm, 'idle'); // covered + native fresh → suppressed
  assert.equal(s.status, 'running', 'heuristic idle suppressed while native running is fresh');
  assert.equal(emitted.length, 0, 'no status emitted for a suppressed transition');
});

test('arbiter: Codex idle-only coverage does NOT suppress heuristic waiting/running', () => {
  const { sm } = mgr();
  const s = inject(sm, { agentType: 'codex', status: 'running', hasUserInputSinceIdle: false });
  sm.applyNativeSignal('s', { state: 'idle', coverage: ['idle'] }); // no done (no user input) → idle
  assert.equal(s.status, 'idle');

  detect(sm, 'waiting'); // 'waiting' NOT in {idle} → passes through
  assert.equal(s.status, 'waiting', 'heuristic waiting reaches a Codex idle-only session');

  detect(sm, 'idle'); // 'idle' IS covered → suppressed
  assert.equal(s.status, 'waiting', 'heuristic idle suppressed (covered by native)');
});

test('arbiter: a stale native window hands control back to the heuristic', () => {
  const { sm } = mgr();
  const s = inject(sm, { agentType: 'claude', status: 'running', hasUserInputSinceIdle: false });
  sm.applyNativeSignal('s', { state: 'running', coverage: FULL });
  s.nativeLastSeenAt = Date.now() - 60_000; // force stale (> 30s)

  detect(sm, 'idle'); // stale → heuristic applies
  assert.equal(s.status, 'idle', 'heuristic resumes once native goes stale (R4)');
});

test('native idle promotes to done immediately — no 2s grace', () => {
  const { sm } = mgr();
  const s = inject(sm, {
    agentType: 'claude',
    status: 'running',
    hasUserInputSinceIdle: true,
    suppressDonePromotion: false,
  });
  sm.applyNativeSignal('s', { state: 'idle', coverage: FULL });
  assert.equal(s.status, 'done', 'native idle is a turn boundary → immediate done');
  assert.equal(s.doneTimer, undefined, 'no pending done-grace timer');
});

test('native running cancels a pending heuristic done-grace timer', () => {
  const { sm } = mgr();
  const s = inject(sm, { agentType: 'claude', status: 'running', hasUserInputSinceIdle: true });
  detect(sm, 'idle'); // heuristic idle → done candidate → arms 2s timer, status stays running
  assert.ok(s.doneTimer, 'heuristic armed a done-grace timer');
  assert.equal(s.status, 'running');

  sm.applyNativeSignal('s', { state: 'running', coverage: FULL });
  assert.equal(s.doneTimer, undefined, 'native signal cancels the pending grace');
  assert.equal(s.status, 'running');
});

test('sticky done: a native idle while already done is a no-op', () => {
  const { sm, emitted } = mgr();
  const s = inject(sm, { agentType: 'claude', status: 'done' });
  emitted.length = 0;
  sm.applyNativeSignal('s', { state: 'idle', coverage: FULL });
  assert.equal(s.status, 'done', 'done is sticky vs a repeat idle');
  assert.equal(emitted.length, 0);
});

test('native waiting promptText wins over screen scraping (R7)', () => {
  const { sm } = mgr();
  const s = inject(sm, { agentType: 'claude', status: 'running' });
  sm.applyNativeSignal('s', { state: 'waiting', promptText: 'Approve edit to foo.ts?', coverage: FULL });
  assert.equal(s.status, 'waiting');
  assert.equal(s.lastPrompt, 'Approve edit to foo.ts?', 'native promptText used, not getLastPromptText()');
});

test('native waiting without promptText falls back to scraping', () => {
  const { sm } = mgr();
  const s = inject(sm, { agentType: 'claude', status: 'running' });
  sm.applyNativeSignal('s', { state: 'waiting', coverage: FULL });
  assert.equal(s.lastPrompt, 'SCRAPED', 'falls back to getLastPromptText() when no native text');
});

test('applyNativeSignal ignores unknown and exited sessions', () => {
  const { sm } = mgr();
  assert.doesNotThrow(() => sm.applyNativeSignal('nope', { state: 'idle' }));
  const s = inject(sm, { status: 'exited' });
  sm.applyNativeSignal('s', { state: 'running', coverage: FULL });
  assert.equal(s.status, 'exited', 'exited sessions are never revived by a native signal');
});
