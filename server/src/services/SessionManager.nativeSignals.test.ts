import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';
import type { AgentSignalState } from '@argus/shared';

process.env.ARGUS_PTY_BACKEND = 'tmux'; // pin backend so a built argusd binary doesn't flip the default

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
    stateDetector: { getLastPromptText: () => 'SCRAPED', resize: () => {}, getStatus: () => 'idle', msSinceLastFeed: () => Infinity },
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

test('arbiter: a readable menu after a fresh native running applies at once (PreToolUse → permission prompt)', () => {
  // Real timing (Claude Code 2.1.311): PreToolUse(AskUserQuestion) marks the
  // session running, the menu paints, and the waiting Notification lands ~6s
  // later. Until then Chat showed no prompt card.
  const { sm, emitted } = mgr();
  let options: Array<{ key: string; label: string }> | undefined;
  const s = inject(sm, {
    agentType: 'claude',
    status: 'running',
    hasUserInputSinceIdle: false,
    stateDetector: { getLastPromptText: () => 'Tea or coffee?', getStatus: () => 'waiting', msSinceLastFeed: () => Infinity, getMenuOptions: () => options },
  });
  sm.applyNativeSignal('s', { state: 'running', coverage: FULL });
  options = [{ key: '1', label: 'Tea' }, { key: '2', label: 'Coffee' }];
  detect(sm, 'waiting');
  assert.equal(s.status, 'waiting');
  const p = emitted.at(-1)!.p;
  assert.deepEqual(p.promptOptions, options);
  assert.equal(p.promptQuestion, 'Tea or coffee?');

  // The Notification's generic text becomes lastPrompt; the card keeps the screen's question.
  sm.applyNativeSignal('s', { state: 'waiting', promptText: 'Claude needs your permission', coverage: FULL });
  assert.equal(emitted.at(-1)!.p.lastPrompt, 'Claude needs your permission');
  assert.equal(emitted.at(-1)!.p.promptQuestion, 'Tea or coffee?');
});

test('arbiter: a menu already on screen at the native running is a leftover, not its prompt', () => {
  const { sm } = mgr();
  const options = [{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }];
  const s = inject(sm, {
    agentType: 'claude',
    status: 'running',
    hasUserInputSinceIdle: false,
    stateDetector: { getLastPromptText: () => 'Proceed?', getStatus: () => 'waiting', msSinceLastFeed: () => Infinity, getMenuOptions: () => options },
  });
  sm.applyNativeSignal('s', { state: 'running', coverage: FULL });
  detect(sm, 'waiting');
  assert.equal(s.status, 'running');
});

test('arbiter: a menu long after the native running does not override it', () => {
  const { sm } = mgr();
  let options: Array<{ key: string; label: string }> | undefined;
  const s = inject(sm, {
    agentType: 'claude',
    status: 'running',
    hasUserInputSinceIdle: false,
    stateDetector: { getLastPromptText: () => 'Proceed?', getStatus: () => 'waiting', msSinceLastFeed: () => Infinity, getMenuOptions: () => options },
  });
  sm.applyNativeSignal('s', { state: 'running', coverage: FULL });
  s.nativeLastSeenAt = Date.now() - 20_000; // still fresh (30s), past the 15s prompt window
  options = [{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }];
  detect(sm, 'waiting');
  assert.equal(s.status, 'running');
});

test('arbiter: without a readable menu a fresh native running still suppresses heuristic waiting', () => {
  const { sm } = mgr();
  const s = inject(sm, { agentType: 'claude', status: 'running', hasUserInputSinceIdle: false });
  sm.applyNativeSignal('s', { state: 'running', coverage: FULL });
  detect(sm, 'waiting');
  assert.equal(s.status, 'running');
});

test('arbiter: a suppressed waiting still refreshes a menu painted after the native waiting', () => {
  const { sm, emitted } = mgr();
  let options: Array<{ key: string; label: string }> | undefined;
  inject(sm, {
    agentType: 'claude',
    status: 'running',
    hasUserInputSinceIdle: false,
    stateDetector: { getLastPromptText: () => 'Proceed?', getStatus: () => 'waiting', msSinceLastFeed: () => Infinity, getMenuOptions: () => options },
  });
  sm.applyNativeSignal('s', { state: 'waiting', promptText: 'Claude needs your permission', coverage: FULL });
  assert.equal(emitted.at(-1)!.p.promptOptions, undefined, 'hook fired before the menu painted');
  options = [{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }];
  detect(sm, 'waiting'); // covered by the fresh native waiting → dropped, but the menu is re-read
  assert.deepEqual(emitted.at(-1)!.p.promptOptions, options);
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

test('arbiter: heuristic running overrides a fresh native waiting (genuine prompt, background subagent streaming)', () => {
  const { sm } = mgr();
  const s = inject(sm, { agentType: 'claude', status: 'running', hasUserInputSinceIdle: false });
  // A genuine permission prompt lands while a background Task keeps painting the
  // screen. (The 60s "waiting for your input" nudge is a different Notification
  // flavour — see the idle-nudge tests below.)
  sm.applyNativeSignal('s', { state: 'waiting', promptText: 'Approve edit to foo.ts?', coverage: FULL });
  assert.equal(s.status, 'waiting');

  detect(sm, 'running'); // real output activity — cannot be faked
  assert.equal(s.status, 'running', 'heuristic running wins over a fresh native waiting');
  assert.equal(s.lastPrompt, undefined, 'prompt cleared when activity resumes');
});

test('arbiter: heuristic running overrides a fresh native idle (Stop fired mid-background-task)', () => {
  const { sm } = mgr();
  const s = inject(sm, { agentType: 'claude', status: 'running', hasUserInputSinceIdle: false });
  sm.applyNativeSignal('s', { state: 'idle', coverage: FULL }); // no done (no user input) → idle
  assert.equal(s.status, 'idle');

  detect(sm, 'running');
  assert.equal(s.status, 'running', 'heuristic running wins over a fresh native idle');
});

test('arbiter: a stale native window hands control back to the heuristic', () => {
  const { sm } = mgr();
  const s = inject(sm, { agentType: 'claude', status: 'running', hasUserInputSinceIdle: false });
  sm.applyNativeSignal('s', { state: 'running', coverage: FULL });
  s.nativeLastSeenAt = Date.now() - 60_000; // force stale (> 30s)

  detect(sm, 'idle'); // stale → heuristic applies
  assert.equal(s.status, 'idle', 'heuristic resumes once native goes stale (R4)');
});

test('native idle on a quiet screen promotes to done immediately — no 2s grace', () => {
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

test('native idle while output still streams arms the grace timer instead of immediate done', () => {
  const { sm } = mgr();
  const s = inject(sm, {
    agentType: 'claude',
    status: 'running',
    hasUserInputSinceIdle: true,
    suppressDonePromotion: false,
    stateDetector: { getLastPromptText: () => 'SCRAPED', resize: () => {}, getStatus: () => 'idle', msSinceLastFeed: () => 100 },
  });
  // Claude fires Stop while a background Task subagent keeps painting the screen.
  sm.applyNativeSignal('s', { state: 'idle', coverage: FULL });
  assert.equal(s.status, 'running', 'no immediate done while the terminal is active');
  assert.ok(s.doneTimer, 'grace timer armed to re-check once output settles');
  clearTimeout(s.doneTimer);
});

test('done-grace fire skips promotion while output still streams', () => {
  const { sm, emitted } = mgr();
  const s = inject(sm, {
    agentType: 'claude',
    status: 'running',
    hasUserInputSinceIdle: true,
    stateDetector: { getLastPromptText: () => 'SCRAPED', resize: () => {}, getStatus: () => 'idle', msSinceLastFeed: () => 100 },
  });
  emitted.length = 0;
  (sm as any).tryPromoteDone('s');
  assert.equal(s.status, 'running', 'promotion skipped — background task still working');
  assert.equal(emitted.length, 0, 'no status emitted');
  assert.notEqual(s.doneTimer, undefined, 're-checks later instead of giving up');
  clearTimeout(s.doneTimer);
});

test('done-grace fire promotes once output has gone quiet', () => {
  const { sm } = mgr();
  let quietMs = 100;
  const s = inject(sm, {
    agentType: 'claude',
    status: 'running',
    hasUserInputSinceIdle: true,
    stateDetector: { getLastPromptText: () => 'SCRAPED', resize: () => {}, getStatus: () => 'idle', msSinceLastFeed: () => quietMs },
  });
  sm.applyNativeSignal('s', { state: 'idle', coverage: FULL });
  assert.equal(s.status, 'running');
  quietMs = 5_000; // output stopped
  (sm as any).tryPromoteDone('s');
  assert.equal(s.status, 'done', 'quiet screen at grace fire → genuine finish');
  clearTimeout(s.doneTimer);
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

test('Claude idle nudge does not resurrect a done session (the finished-turn false positive)', () => {
  const { sm, emitted } = mgr();
  const s = inject(sm, { agentType: 'claude', status: 'done' });
  emitted.length = 0;
  // ~60s after the turn finished Claude fires its "waiting for your input" nudge,
  // wired to `waiting`. It is not a pending decision — the session stays done.
  sm.applyNativeSignal('s', { state: 'waiting', promptText: 'Claude is waiting for your input', coverage: FULL });
  assert.equal(s.status, 'done', 'idle nudge coerced to a turn boundary; done stays done');
  assert.equal(emitted.length, 0, 'no bogus waiting emitted');
});

test('Claude idle nudge does not flip an idle session to waiting', () => {
  const { sm } = mgr();
  const s = inject(sm, { agentType: 'claude', status: 'idle', hasUserInputSinceIdle: false });
  sm.applyNativeSignal('s', { state: 'waiting', promptText: 'Claude is waiting for your input', coverage: FULL });
  assert.equal(s.status, 'idle', 'idle nudge stays idle, never waiting');
  assert.equal(s.lastPrompt, undefined, 'no prompt text from the generic nudge');
});

test('a genuine permission prompt is unaffected by idle-nudge coercion', () => {
  const { sm } = mgr();
  const s = inject(sm, { agentType: 'claude', status: 'running' });
  sm.applyNativeSignal('s', { state: 'waiting', promptText: 'Claude needs your permission to use Bash', coverage: FULL });
  assert.equal(s.status, 'waiting', 'real prompt still raises waiting');
  assert.equal(s.lastPrompt, 'Claude needs your permission to use Bash');
});

test('applyNativeSignal ignores unknown and exited sessions', () => {
  const { sm } = mgr();
  assert.doesNotThrow(() => sm.applyNativeSignal('nope', { state: 'idle' }));
  const s = inject(sm, { status: 'exited' });
  sm.applyNativeSignal('s', { state: 'running', coverage: FULL });
  assert.equal(s.status, 'exited', 'exited sessions are never revived by a native signal');
});

// Regression: "ciao, come va?" → Claude answers → Stop hook fires while the last
// frame is still painting → the session stayed RUNNING forever.
test('a native idle deferred behind a painting screen still lands as done once the screen settles', () => {
  const { sm } = mgr();
  let quietMs = 100;
  const s = inject(sm, {
    agentType: 'claude',
    status: 'running',
    hasUserInputSinceIdle: true,
    stateDetector: { getLastPromptText: () => 'SCRAPED', resize: () => {}, getStatus: () => 'idle', msSinceLastFeed: () => quietMs },
  });
  sm.applyNativeSignal('s', { state: 'idle', coverage: FULL }); // deferred: screen painting
  assert.equal(s.status, 'running');
  (sm as any).tryPromoteDone('s'); // first grace: still painting
  assert.equal(s.status, 'running');
  assert.notEqual(s.doneTimer, undefined, 'still waiting, not given up');
  clearTimeout(s.doneTimer); s.doneTimer = undefined;
  quietMs = 5_000;
  (sm as any).tryPromoteDone('s'); // next grace: quiet now
  assert.equal(s.status, 'done');
});

test('while native idle is fresh, a heuristic idle that agrees with it is not dropped', () => {
  const { sm } = mgr();
  const s = inject(sm, {
    agentType: 'claude',
    status: 'running',
    hasUserInputSinceIdle: true,
    stateDetector: { getLastPromptText: () => 'SCRAPED', resize: () => {}, getStatus: () => 'idle', msSinceLastFeed: () => 100 },
  });
  sm.applyNativeSignal('s', { state: 'idle', coverage: FULL }); // deferred
  clearTimeout(s.doneTimer); s.doneTimer = undefined;
  detect(sm, 'idle'); // the screen settles — must reach the done path, not be suppressed
  assert.notEqual(s.doneTimer, undefined, 'done promotion armed from the agreeing heuristic idle');
  clearTimeout(s.doneTimer);
});

test('a quiet screen with the working footer still on it keeps waiting (background subagent)', () => {
  const { sm } = mgr();
  const s = inject(sm, {
    agentType: 'claude',
    status: 'running',
    hasUserInputSinceIdle: true,
    stateDetector: { getLastPromptText: () => 'SCRAPED', resize: () => {}, getStatus: () => 'running', msSinceLastFeed: () => 5_000 },
  });
  (sm as any).tryPromoteDone('s');
  assert.equal(s.status, 'running', 'footer says work is ongoing');
  assert.notEqual(s.doneTimer, undefined);
  clearTimeout(s.doneTimer);
});

test('an Esc interrupt lets the settled idle through a fresh native running (no Stop hook fires)', () => {
  const { sm, emitted } = mgr();
  const s = inject(sm, { agentType: 'claude', status: 'running', pty: { write: () => {} } });
  sm.applyNativeSignal('s', { state: 'running', coverage: FULL });
  s.nativeLastSeenAt = Date.now() - 10; // the hook came before the Esc
  sm.writeToSession('s', '\x1b');
  emitted.length = 0;

  detect(sm, 'idle');
  assert.equal(s.status, 'idle', 'a stopped turn is idle, not done');
  assert.equal(emitted.length, 1);
});

test('a native signal after the Esc ends the interrupt exception', () => {
  const { sm } = mgr();
  const s = inject(sm, { agentType: 'claude', status: 'running', pty: { write: () => {} } });
  sm.writeToSession('s', '\x1b');
  s.interruptedAt = Date.now() - 10;
  sm.applyNativeSignal('s', { state: 'running', coverage: FULL }); // a new turn started

  detect(sm, 'idle');
  assert.equal(s.status, 'running', 'heuristic idle suppressed again');
});

test('after an Esc interrupt the settled idle is re-applied when no transition comes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sm } = mgr();
  const s = inject(sm, { agentType: 'claude', status: 'running', pty: { write: () => {} } });
  sm.applyNativeSignal('s', { state: 'running', coverage: FULL });
  s.nativeLastSeenAt = Date.now() - 10;
  sm.writeToSession('s', '\x1b');
  assert.equal(s.status, 'running');

  t.mock.timers.tick(1_500);
  assert.equal(s.status, 'idle', 'the detector already read idle: the session leaves running');
});
