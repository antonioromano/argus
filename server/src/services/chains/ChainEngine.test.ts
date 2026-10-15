import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionChain, SessionStatus } from '@argus/shared';
import {
  CHAIN_DEBOUNCE_MS,
  CHAIN_QUEUE_MAX_WAIT_MS,
  CHAIN_TARGET_COOLDOWN_MS,
  CHAIN_USER_QUIET_MS,
  ChainEngine,
  type ChainSessionView,
} from './ChainEngine.js';
import { CHAIN_GLOBAL_MAX_FIRES_PER_HOUR, CHAIN_MAX_FIRES_PER_HOUR, CHAIN_PROMPT_MAX } from '../../constants/chains.js';

// Beta F13 chain engine, driven by an injected clock and timer queue: no
// global fake timers (mock.timers hangs TerminalMirror awaits — see memory).

class FakeClock {
  t = 1_000_000;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  setTimer = (fn: () => void, ms: number) => { const id = ++this.seq; this.timers.set(id, { at: this.t + ms, fn }); return id; };
  clearTimer = (h: unknown) => { this.timers.delete(h as number); };
  get pendingTimers() { return this.timers.size; }
  /** Advance time, running every timer that comes due, in order. */
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const e of this.timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = end;
  }
}

function setup(opts: { enabled?: boolean; stored?: SessionChain[] } = {}) {
  const clock = new FakeClock();
  const sessions = new Map<string, ChainSessionView>([
    ['A', { status: 'running', agentType: 'claude', name: 'api' }],
    ['B', { status: 'idle', agentType: 'claude', name: 'client' }],
    ['C', { status: 'idle', agentType: 'codex', name: 'reviewer' }],
    ['SH', { status: 'idle', agentType: 'shell', name: 'zsh' }],
    ['X', { status: 'exited', agentType: 'claude', name: 'dead' }],
  ]);
  let enabled = opts.enabled ?? true;
  let saved: SessionChain[] = opts.stored ?? [];
  const writes: Array<[string, string, number | undefined]> = [];
  let pendingInput = false;
  let changes = 0;
  const engine = new ChainEngine({
    isEnabled: () => enabled,
    store: { load: async () => structuredClone(saved), save: async (l) => { saved = structuredClone(l); } },
    session: (id) => sessions.get(id),
    write: (id, data, pause) => { writes.push([id, data, pause]); },
    inputPending: () => pendingInput,
    enterDelayMs: 60,
    now: () => clock.t,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    newId: (() => { let n = 0; return () => `c${++n}`; })(),
    onChange: () => { changes++; },
  });
  /** Change a session's status and tell the engine, as SessionManager.emitStatus would. */
  const status = (id: string, s: SessionStatus) => {
    sessions.get(id)!.status = s;
    engine.handleStatus(id, s);
  };
  const create = (body: Record<string, unknown>) => {
    const r = engine.create({ sourceId: 'A', targetId: 'B', trigger: 'idle', prompt: 'run the tests', ...body });
    if (!r.ok) throw new Error(r.error);
    return r.chain;
  };
  const sent = () => writes.filter(([, d]) => d !== '\r').map(([id, d]) => `${id}:${d}`);
  return {
    clock, sessions, engine, writes, sent, status, create,
    setEnabled: (v: boolean) => { enabled = v; },
    setPendingInput: (v: boolean) => { pendingInput = v; },
    saved: () => saved,
    changes: () => changes,
  };
}

describe('validation', () => {
  test('A ≠ B, both existing and live, target not a plain shell', () => {
    const { engine } = setup();
    const base = { sourceId: 'A', targetId: 'B', trigger: 'idle', prompt: 'go' };
    const err = (body: Record<string, unknown>) => { const r = engine.create({ ...base, ...body }); return r.ok ? null : r.error; };
    assert.match(err({ targetId: 'A' })!, /own session/);
    assert.match(err({ sourceId: 'nope' })!, /Unknown source/);
    assert.match(err({ targetId: 'nope' })!, /Unknown target/);
    assert.match(err({ sourceId: 'X' })!, /source session has exited/);
    assert.match(err({ targetId: 'X' })!, /target session has exited/);
    assert.match(err({ targetId: 'SH' })!, /not a plain shell/);
    // A plain shell may be the source.
    assert.equal(err({ sourceId: 'SH' }), null);
  });

  test('trigger, mode and prompt are checked', () => {
    const { engine } = setup();
    const base = { sourceId: 'A', targetId: 'B', trigger: 'idle', prompt: 'go' };
    const err = (body: Record<string, unknown>) => { const r = engine.create({ ...base, ...body }); return r.ok ? null : r.error; };
    assert.match(err({ trigger: 'running' })!, /trigger/);
    assert.match(err({ mode: 'forever' })!, /mode/);
    assert.match(err({ prompt: '   ' })!, /required/);
    assert.match(err({ prompt: 'x'.repeat(CHAIN_PROMPT_MAX + 1) })!, /longer than 4000/);
    assert.match(err({ prompt: 'two\nlines' })!, /single line/);
    assert.match(String((engine.create(null) as { error: string }).error), /Invalid/);
    assert.equal(err({ prompt: 'x'.repeat(CHAIN_PROMPT_MAX) }), null);
  });

  test('mode defaults to once and a new chain starts armed', () => {
    const { create } = setup();
    const c = create({});
    assert.equal(c.mode, 'once');
    assert.equal(c.armed, true);
    assert.equal(c.fireCount, 0);
  });

  test('refuses a chain that closes a cycle of repeat chains', () => {
    const { engine, create } = setup();
    create({ mode: 'repeat' }); // A → B
    const back = engine.create({ sourceId: 'B', targetId: 'A', trigger: 'idle', mode: 'repeat', prompt: 'p' });
    assert.equal(back.ok, false);
    assert.match((back as { error: string }).error, /loop/);
    // A longer loop: B → C, then C → A closes A → B → C → A.
    assert.equal(engine.create({ sourceId: 'B', targetId: 'C', trigger: 'idle', mode: 'repeat', prompt: 'p' }).ok, true);
    assert.equal(engine.create({ sourceId: 'C', targetId: 'A', trigger: 'done', mode: 'repeat', prompt: 'p' }).ok, false);
    // A once chain can't loop forever, so it is allowed.
    assert.equal(engine.create({ sourceId: 'B', targetId: 'A', trigger: 'idle', mode: 'once', prompt: 'p' }).ok, true);
  });
});

describe('edge trigger', () => {
  test('fires once, after the debounce, on the transition into the trigger state', () => {
    const { clock, status, create, sent } = setup();
    create({ mode: 'repeat' });
    status('A', 'idle');
    clock.advance(CHAIN_DEBOUNCE_MS - 1);
    assert.deepEqual(sent(), []);
    clock.advance(1);
    assert.deepEqual(sent(), ['B:run the tests']);
  });

  test('no refire while A stays in the state, even with repeated status emits', () => {
    const { clock, status, create, sent } = setup();
    create({ mode: 'repeat' });
    status('A', 'idle');
    clock.advance(CHAIN_DEBOUNCE_MS);
    for (let i = 0; i < 5; i++) { status('A', 'idle'); clock.advance(10_000); }
    assert.equal(sent().length, 1);
  });

  test('a brief blip into the state does not fire', () => {
    const { clock, status, create, sent } = setup();
    create({ mode: 'repeat' });
    status('A', 'idle');
    clock.advance(1_000);
    status('A', 'running');
    clock.advance(CHAIN_DEBOUNCE_MS * 2);
    assert.deepEqual(sent(), []);
  });

  test('a source already in the trigger state when the chain is created waits for the next edge', () => {
    const { clock, status, create, sent, sessions } = setup();
    sessions.get('A')!.status = 'idle';
    create({});
    status('A', 'idle'); // a re-emit, not an edge
    clock.advance(CHAIN_DEBOUNCE_MS * 2);
    assert.deepEqual(sent(), []);
    status('A', 'running');
    status('A', 'idle');
    clock.advance(CHAIN_DEBOUNCE_MS);
    assert.equal(sent().length, 1);
  });

  test('only the configured trigger fires', () => {
    const { clock, status, create, sent } = setup();
    create({ trigger: 'waiting', mode: 'repeat' });
    status('A', 'idle');
    clock.advance(CHAIN_DEBOUNCE_MS);
    status('A', 'done');
    clock.advance(CHAIN_DEBOUNCE_MS);
    assert.deepEqual(sent(), []);
    status('A', 'waiting');
    clock.advance(CHAIN_DEBOUNCE_MS);
    assert.equal(sent().length, 1);
  });

  test('delivery is text, then a delayed Enter as its own write', () => {
    const { clock, status, create, writes } = setup();
    create({});
    status('A', 'idle');
    clock.advance(CHAIN_DEBOUNCE_MS);
    assert.deepEqual(writes, [['B', 'run the tests', 60], ['B', '\r', undefined]]);
  });

  test('nothing fires while the flag is off', () => {
    const { clock, status, create, sent, setEnabled } = setup();
    create({ mode: 'repeat' });
    setEnabled(false);
    status('A', 'idle');
    clock.advance(CHAIN_DEBOUNCE_MS);
    assert.deepEqual(sent(), []);
    // Turned off mid-debounce: the pending fire is cancelled too.
    setEnabled(true);
    status('A', 'running');
    status('A', 'idle');
    setEnabled(false);
    clock.advance(CHAIN_DEBOUNCE_MS);
    assert.deepEqual(sent(), []);
  });

  test('with no chains the hook does nothing and starts no timers', () => {
    const { clock, engine } = setup();
    engine.handleStatus('A', 'idle');
    engine.noteUserInput('B');
    assert.equal(clock.pendingTimers, 0);
  });
});

describe('modes', () => {
  test('once disarms after its fire, with a reason', () => {
    const { clock, status, create, sent, engine } = setup();
    create({});
    status('A', 'idle');
    clock.advance(CHAIN_DEBOUNCE_MS);
    const [c] = engine.list();
    assert.equal(c.armed, false);
    assert.equal(c.disarmedReason, 'Fired once');
    assert.equal(c.fireCount, 1);
    status('A', 'running');
    status('A', 'idle');
    clock.advance(CHAIN_DEBOUNCE_MS);
    assert.equal(sent().length, 1);
  });

  test('repeat fires on every edge', () => {
    const { clock, status, create, sent, engine } = setup();
    create({ mode: 'repeat' });
    for (let i = 0; i < 3; i++) {
      status('A', 'running');
      status('A', 'idle');
      clock.advance(CHAIN_DEBOUNCE_MS + CHAIN_TARGET_COOLDOWN_MS);
    }
    assert.equal(sent().length, 3);
    assert.equal(engine.list()[0].armed, true);
  });

  test('re-arming a once chain lets it fire again', () => {
    const { clock, status, create, sent, engine } = setup();
    const c = create({});
    status('A', 'idle');
    clock.advance(CHAIN_DEBOUNCE_MS + CHAIN_TARGET_COOLDOWN_MS);
    assert.equal(engine.setArmed(c.id, true)?.armed, true);
    assert.equal(engine.list()[0].disarmedReason, undefined);
    status('A', 'running');
    status('A', 'idle');
    clock.advance(CHAIN_DEBOUNCE_MS);
    assert.equal(sent().length, 2);
  });

  test('a disarmed chain does not fire', () => {
    const { clock, status, create, sent, engine } = setup();
    const c = create({ mode: 'repeat' });
    engine.setArmed(c.id, false);
    assert.equal(engine.list()[0].disarmedReason, 'Disarmed by you');
    status('A', 'idle');
    clock.advance(CHAIN_DEBOUNCE_MS);
    assert.deepEqual(sent(), []);
  });
});

describe('rate caps', () => {
  const cycle = (h: ReturnType<typeof setup>, source = 'A') => {
    h.status(source, 'running');
    h.status(source, 'idle');
    h.clock.advance(CHAIN_DEBOUNCE_MS + CHAIN_TARGET_COOLDOWN_MS);
  };

  test(`a chain disarms itself after ${CHAIN_MAX_FIRES_PER_HOUR} fires within an hour`, () => {
    const h = setup();
    h.create({ mode: 'repeat' });
    for (let i = 0; i < CHAIN_MAX_FIRES_PER_HOUR + 3; i++) cycle(h);
    assert.equal(h.sent().length, CHAIN_MAX_FIRES_PER_HOUR);
    const [c] = h.engine.list();
    assert.equal(c.armed, false);
    assert.match(c.disarmedReason!, /10 times within an hour/);
  });

  test('fires spread over more than an hour do not trip the per-chain cap', () => {
    const h = setup();
    h.create({ mode: 'repeat' });
    for (let i = 0; i < CHAIN_MAX_FIRES_PER_HOUR + 5; i++) { cycle(h); h.clock.advance(10 * 60_000); }
    assert.equal(h.sent().length, CHAIN_MAX_FIRES_PER_HOUR + 5);
    assert.equal(h.engine.list()[0].armed, true);
  });

  test(`all chains together fire at most ${CHAIN_GLOBAL_MAX_FIRES_PER_HOUR} times per hour`, () => {
    const h = setup();
    // 4 sources × 1 chain each, all into distinct agent targets.
    const ids = ['S1', 'S2', 'S3', 'S4'];
    for (const id of ids) {
      h.sessions.set(id, { status: 'running', agentType: 'claude' });
      h.sessions.set(`T${id}`, { status: 'idle', agentType: 'claude' });
      h.create({ sourceId: id, targetId: `T${id}`, mode: 'repeat' });
    }
    for (let round = 0; round < 9; round++) for (const id of ids) cycle(h, id);
    assert.equal(h.sent().length, CHAIN_GLOBAL_MAX_FIRES_PER_HOUR);
    const dropped = h.engine.audit().filter((f) => f.outcome === 'dropped');
    assert.ok(dropped.length > 0);
    assert.match(dropped[0].reason!, /Global limit: 30/);
    // The global cap drops fires but does not disarm anyone.
    assert.ok(h.engine.list().every((c) => c.armed));
    // An hour later the budget is back.
    h.clock.advance(3_600_000);
    cycle(h, 'S1');
    assert.equal(h.sent().length, CHAIN_GLOBAL_MAX_FIRES_PER_HOUR + 1);
  });
});

describe('delivery to a busy target', () => {
  test('a running target queues the prompt and gets it when it settles', () => {
    const h = setup();
    h.create({});
    h.sessions.get('B')!.status = 'running';
    h.status('A', 'idle');
    h.clock.advance(CHAIN_DEBOUNCE_MS);
    assert.deepEqual(h.sent(), []);
    assert.equal(h.engine.audit()[0].outcome, 'queued');
    assert.equal(h.engine.audit()[0].reason, 'Target is busy');
    h.clock.advance(60_000);
    h.status('B', 'waiting');
    assert.deepEqual(h.sent(), ['B:run the tests']);
    assert.equal(h.engine.audit()[0].outcome, 'sent');
  });

  test('a queued prompt is dropped after 10 minutes', () => {
    const h = setup();
    h.create({});
    h.sessions.get('B')!.status = 'running';
    h.status('A', 'idle');
    h.clock.advance(CHAIN_DEBOUNCE_MS + CHAIN_QUEUE_MAX_WAIT_MS);
    assert.equal(h.engine.audit()[0].outcome, 'dropped');
    assert.match(h.engine.audit()[0].reason!, /busy for 10 minutes/);
    h.status('B', 'idle');
    assert.deepEqual(h.sent(), []);
  });

  test('a target that exits while a prompt is queued drops it', () => {
    const h = setup();
    h.create({});
    h.sessions.get('B')!.status = 'running';
    h.status('A', 'idle');
    h.clock.advance(CHAIN_DEBOUNCE_MS);
    h.status('B', 'exited');
    assert.equal(h.engine.audit()[0].outcome, 'dropped');
    assert.equal(h.engine.audit()[0].reason, 'Target exited');
  });

  test('never types over the user: waits for a quiet moment after their last keystroke', () => {
    const h = setup();
    h.create({});
    h.status('A', 'idle');
    h.clock.advance(CHAIN_DEBOUNCE_MS - 500);
    h.engine.noteUserInput('B');
    h.clock.advance(500);
    assert.deepEqual(h.sent(), []);
    assert.equal(h.engine.audit()[0].reason, 'You are typing in the target');
    h.clock.advance(CHAIN_USER_QUIET_MS);
    assert.deepEqual(h.sent(), ['B:run the tests']);
  });

  test('waits while the input queue still holds an Enter for the target', () => {
    const h = setup();
    h.create({});
    h.setPendingInput(true);
    h.status('A', 'idle');
    h.clock.advance(CHAIN_DEBOUNCE_MS);
    assert.deepEqual(h.sent(), []);
    h.setPendingInput(false);
    h.clock.advance(300);
    assert.deepEqual(h.sent(), ['B:run the tests']);
  });

  test('a menu on screen counts as busy (typing would answer it)', () => {
    const h = setup();
    h.create({});
    h.sessions.get('B')!.status = 'waiting';
    h.sessions.get('B')!.menuOpen = true;
    h.status('A', 'idle');
    h.clock.advance(CHAIN_DEBOUNCE_MS);
    assert.deepEqual(h.sent(), []);
    h.sessions.get('B')!.menuOpen = false;
    h.status('B', 'idle');
    assert.deepEqual(h.sent(), ['B:run the tests']);
  });

  test('two queued prompts are delivered one per settle, in order', () => {
    const h = setup();
    h.sessions.set('A2', { status: 'running', agentType: 'claude' });
    h.create({ prompt: 'first' });
    h.create({ sourceId: 'A2', prompt: 'second' });
    h.sessions.get('B')!.status = 'running';
    h.status('A', 'idle');
    h.status('A2', 'idle');
    h.clock.advance(CHAIN_DEBOUNCE_MS);
    h.status('B', 'idle');
    assert.deepEqual(h.sent(), ['B:first']);
    h.status('B', 'running');
    h.clock.advance(CHAIN_TARGET_COOLDOWN_MS);
    assert.deepEqual(h.sent(), ['B:first']);
    h.status('B', 'idle');
    assert.deepEqual(h.sent(), ['B:first', 'B:second']);
  });
});

describe('removal and persistence', () => {
  test('removing the source or the target drops its chains', () => {
    const h = setup();
    h.create({});
    h.create({ sourceId: 'C', targetId: 'B' });
    h.create({ sourceId: 'B', targetId: 'C' });
    h.engine.handleSessionRemoved('A');
    assert.deepEqual(h.engine.list().map((c) => `${c.sourceId}>${c.targetId}`), ['C>B', 'B>C']);
    h.engine.handleSessionRemoved('C');
    assert.deepEqual(h.engine.list(), []);
  });

  test('removing the target drops what was queued for it, and stops the debounce of removed chains', () => {
    const h = setup();
    h.create({});
    h.sessions.get('B')!.status = 'running';
    h.status('A', 'idle');
    h.clock.advance(CHAIN_DEBOUNCE_MS);
    h.sessions.delete('B');
    h.engine.handleSessionRemoved('B');
    assert.equal(h.engine.audit()[0].reason, 'Target was removed');
    assert.equal(h.clock.pendingTimers, 0);
  });

  test('init drops stored chains whose sessions are gone, and saves', async () => {
    const stored = (id: string, sourceId: string, targetId: string): SessionChain => ({
      id, sourceId, targetId, trigger: 'idle', mode: 'once', prompt: 'p', armed: true, createdAt: '', fireCount: 0,
    });
    const h = setup({ stored: [stored('k1', 'A', 'B'), stored('k2', 'A', 'gone'), stored('k3', 'gone', 'B')] });
    await h.engine.init((id) => h.sessions.has(id));
    await h.engine.ready();
    assert.deepEqual(h.engine.list().map((c) => c.id), ['k1']);
    await h.engine.flush();
    assert.deepEqual(h.saved().map((c) => c.id), ['k1']);
  });

  test('every change is persisted and announced', async () => {
    const h = setup();
    const c = h.create({ mode: 'repeat' });
    await h.engine.flush();
    assert.equal(h.saved().length, 1);
    h.engine.setArmed(c.id, false);
    await h.engine.flush();
    assert.equal(h.saved()[0].armed, false);
    assert.equal(h.engine.remove(c.id), true);
    assert.equal(h.engine.remove(c.id), false);
    await h.engine.flush();
    assert.deepEqual(h.saved(), []);
    assert.ok(h.changes() >= 3);
  });

  test('the audit keeps the last 50 fires, newest first, with names', () => {
    const h = setup();
    h.create({ mode: 'repeat' });
    h.sessions.get('B')!.status = 'running';
    // Each edge queues (and hours apart, so the per-chain cap never trips).
    for (let i = 0; i < 60; i++) {
      h.status('A', 'running');
      h.status('A', 'idle');
      h.clock.advance(CHAIN_DEBOUNCE_MS);
      h.clock.advance(3_600_000);
    }
    const audit = h.engine.audit();
    assert.equal(audit.length, 50);
    assert.ok(audit[0].at >= audit[1].at);
    assert.equal(audit.find((f) => f.outcome === 'queued')?.sourceName, 'api');
    assert.equal(audit.find((f) => f.outcome === 'queued')?.targetName, 'client');
  });

  test('countsBySource counts chains per source session', () => {
    const h = setup();
    h.create({});
    h.create({ targetId: 'C' });
    h.create({ sourceId: 'C', targetId: 'B' });
    assert.deepEqual(h.engine.countsBySource(), { A: 2, C: 1 });
  });
});
