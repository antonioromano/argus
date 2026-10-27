import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLaunchGate, LIMITS, type GateDeps } from './launchGate.js';

const V = (over: any = {}) => ({
  request: { agent: 'claude', folder: '/tmp/p', flags: ['--model=opus'], prompt: 'hi', ...over.request },
  agentCommand: 'claude', args: ['--model=opus', 'hi'], command: 'claude --model=opus hi',
  warnings: over.warnings ?? [], folderAgentConfig: [],
});

function make(over: Partial<GateDeps> = {}) {
  let t = 1_000_000; let n = 0;
  const log: string[] = [];
  const deps: GateDeps = {
    now: () => t,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    validate: async (req) => ({ ok: true, value: V({ request: req }) as any }),
    resolveRun: async () => ({ kind: 'unknown' }),
    launch: async (_v, w, l) => { log.push(`launch:${w}:${l ?? ''}`); return { id: 'sess-new' }; },
    saveLauncher: async (i) => { log.push(`save:${i.id}`); return { ok: true }; },
    targetWindow: () => 'main',
    changed: (w, reason) => log.push(`changed:${w}:${reason}`),
    toast: (w, m, tone) => log.push(`toast:${w}:${tone}:${m}`),
    highlight: (w, s) => log.push(`highlight:${w}:${s}`),
    notifyIfBackground: (v) => log.push(`notify:${v.id}`),
    ...over,
  };
  const gate = createLaunchGate(deps);
  return { gate, log, advance: (ms: number) => { t += ms; } };
}
const newLink = (req: any = {}) => ({ ok: true as const, kind: 'new' as const, request: { agent: 'claude', folder: '/tmp/p', flags: [], ...req } });
const runLink = (id: string) => ({ ok: true as const, kind: 'run' as const, launcherId: id });

test('new link → pending card in the target window, never launched directly', async () => {
  const { gate, log } = make();
  await gate.handle(newLink());
  const [card] = gate.list('main');
  assert.equal(card.state, 'pending');
  assert.equal(card.source, 'new');
  assert.equal(card.canSaveAsLauncher, true);
  assert.ok(!log.some((l) => l.startsWith('launch:')));
  assert.ok(log.includes('changed:main:added'));
  assert.ok(log.includes(`notify:${card.id}`));
});

test('identical new link while pending dedupes', async () => {
  const { gate } = make();
  await gate.handle(newLink({ prompt: 'x' }));
  await gate.handle(newLink({ prompt: 'x' }));
  assert.equal(gate.list('main').length, 1);
  await gate.handle(newLink({ prompt: 'y' }));
  assert.equal(gate.list('main').length, 2);
});

test('approve launches, removes the card, highlights; save-as stores a launcher', async () => {
  const { gate, log } = make();
  await gate.handle(newLink());
  const id = gate.list('main')[0].id;
  assert.deepEqual(await gate.approve(id, { id: 'my-launcher', label: 'Mine' }), { ok: true });
  assert.ok(log.includes('launch:main:my-launcher'));
  assert.ok(log.includes('save:my-launcher'));
  assert.ok(log.includes('highlight:main:sess-new'));
  assert.equal(gate.list('main').length, 0);
});

test('save-as is refused for worktree launches', async () => {
  const { gate } = make();
  await gate.handle(newLink({ worktree: 'feat/x' }));
  const card = gate.list('main')[0];
  assert.equal(card.canSaveAsLauncher, false);
  assert.equal((await gate.approve(card.id, { id: 'x', label: 'x' })).ok, false);
});

test('launch failure puts the card in error state; retry works', async () => {
  let fail = true;
  const { gate } = make({ launch: async () => { if (fail) throw new Error('boom'); return { id: 's' }; } });
  await gate.handle(newLink());
  const id = gate.list('main')[0].id;
  assert.equal((await gate.approve(id)).ok, false);
  assert.equal(gate.list('main')[0].state, 'error');
  assert.equal(gate.list('main')[0].error, 'boom');
  fail = false;
  assert.deepEqual(await gate.approve(id), { ok: true });
});

test('invalid new link → error toast, no card; toasts throttled to one per 10 s', async () => {
  const { gate, log, advance } = make({ validate: async () => ({ ok: false, error: 'Folder does not exist' }) });
  await gate.handle(newLink());
  await gate.handle(newLink());
  assert.equal(log.filter((l) => l.startsWith('toast:')).length, 1);
  advance(LIMITS.errorToastMs + 1);
  await gate.handle(newLink());
  assert.ok(log.some((l) => l.includes('1 more invalid link ignored')));
  assert.equal(gate.list('main').length, 0);
});

test('parse errors toast the class only', async () => {
  const { gate, log } = make();
  await gate.handle({ ok: false, error: 'unknown-param' });
  assert.ok(log.some((l) => l.startsWith('toast:main:danger:') && l.includes('unknown-param')));
});

test('run: unknown → toast; live → highlight, no spawn; ready → card (no auto-start); changed → card', async () => {
  const launcher = { id: 'l1', label: 'L1', request: V().request, agentCommand: 'claude', folderConfigAtSave: [], createdAt: '' };
  const res: Record<string, any> = {
    nope: { kind: 'unknown' },
    live: { kind: 'live', sessionId: 'sess-live' },
    ready: { kind: 'ready', launcher, validated: V() },
    changed: { kind: 'changed', launcher, validated: V({ warnings: [{ kind: 'launcher-changed', detail: 'x' }] }) },
    bad: { kind: 'invalid', error: 'Folder does not exist' },
  };
  const { gate, log, advance } = make({ resolveRun: async (id) => res[id] });
  await gate.handle(runLink('nope'));
  assert.ok(log.some((l) => l.includes('No launcher "nope"')));
  advance(LIMITS.burstWindowMs + 1);
  await gate.handle(runLink('live'));
  assert.ok(log.includes('highlight:main:sess-live'));
  assert.ok(!log.some((l) => l.startsWith('launch:')));
  advance(LIMITS.burstWindowMs + 1);
  await gate.handle(runLink('ready'));
  // S6: an external run/<id> link never starts an agent without a click.
  assert.ok(!log.some((l) => l.startsWith('launch:')));
  const readyCard = gate.list('main')[0];
  assert.equal(readyCard.source, 'run');
  assert.equal(readyCard.state, 'pending');
  gate.discard(readyCard.id);
  advance(LIMITS.burstWindowMs + 1);
  await gate.handle(runLink('changed'));
  const card = gate.list('main')[0];
  assert.equal(card.source, 'run');
  assert.equal(card.launcherId, 'l1');
  assert.equal(card.warnings[0].kind, 'launcher-changed');
});

test('cap of 5 pending; 6th → toast', async () => {
  const { gate, log, advance } = make();
  for (let i = 0; i < 6; i++) { await gate.handle(newLink({ prompt: `p${i}` })); advance(LIMITS.burstWindowMs); }
  assert.equal(gate.list('main').length, 5);
  assert.ok(log.some((l) => l.includes('Too many pending launches')));
});

test('burst: more than 3 links in 10 s are dropped', async () => {
  const { gate } = make();
  for (let i = 0; i < 5; i++) await gate.handle(newLink({ prompt: `b${i}` }));
  assert.equal(gate.list('main').length, 3);
});

test('expiry → expired state (kept until dismissed); approve refused', async () => {
  const { gate, advance } = make();
  await gate.handle(newLink());
  const id = gate.list('main')[0].id;
  advance(LIMITS.expiryMs + 1);
  gate.tick();
  assert.equal(gate.list('main')[0].state, 'expired');
  assert.equal((await gate.approve(id)).ok, false);
  gate.discard(id);
  assert.equal(gate.list('main').length, 0);
});

test('rehome moves cards of a closed window to main', async () => {
  const { gate } = make({ targetWindow: () => 'w2' });
  await gate.handle(newLink());
  const id = gate.list('w2')[0].id;
  gate.rehome('w2');
  assert.equal(gate.windowOf(id), 'main');
  assert.equal(gate.list('main').length, 1);
});

test('I4: only a new card or a dedupe refocus reports "added"; expiry, rehome, approve report "updated"', async () => {
  const { gate, log, advance } = make({ targetWindow: () => 'w2' });
  await gate.handle(newLink({ prompt: 'x' }));
  assert.deepEqual(log.filter((l) => l.startsWith('changed:')), ['changed:w2:added']);
  let n = log.length;
  await gate.handle(newLink({ prompt: 'x' }));                 // dedupe hit re-focuses
  assert.deepEqual(log.slice(n).filter((l) => l.startsWith('changed:')), ['changed:w2:added']);

  n = log.length;
  advance(LIMITS.expiryMs + 1);
  gate.tick();
  gate.rehome('w2');
  const later = log.slice(n).filter((l) => l.startsWith('changed:'));
  assert.deepEqual(later, ['changed:w2:updated', 'changed:main:updated']);

  await gate.handle(newLink({ prompt: 'y' }));
  const id = gate.list('w2').find((c) => c.prompt === 'y')!.id;
  n = log.length;
  await gate.approve(id);
  gate.discard(gate.list('main')[0].id);
  assert.ok(log.slice(n).filter((l) => l.startsWith('changed:')).every((l) => l.endsWith(':updated')));
});

test('T9: approving a new card with save-as toasts "Saved launcher run/<id>" after the launch', async () => {
  const { gate, log } = make();
  await gate.handle(newLink());
  const id = gate.list('main')[0].id;
  assert.deepEqual(await gate.approve(id, { id: 'my-launcher', label: 'Mine' }), { ok: true });
  const toastAt = log.indexOf('toast:main:ok:Saved launcher run/my-launcher');
  assert.ok(toastAt > log.indexOf('launch:main:my-launcher'), log.join('\n'));
});

test('T9: no saved toast without save-as, or when the launch fails', async () => {
  const { gate, log } = make();
  await gate.handle(newLink({ prompt: 'a' }));
  await gate.approve(gate.list('main')[0].id);
  assert.ok(!log.some((l) => l.includes('Saved launcher')));
  const f = make({ launch: async () => { throw new Error('boom'); } });
  await f.gate.handle(newLink());
  await f.gate.approve(f.gate.list('main')[0].id, { id: 'x1', label: 'X' });
  assert.ok(!f.log.some((l) => l.includes('Saved launcher')));
});

test('unknown id: approve refused, has() false', async () => {
  const { gate } = make();
  assert.equal(gate.has('nope'), false);
  assert.equal((await gate.approve('nope')).ok, false);
});

// ---- fix round 1 ----
const launcherL1 = () => ({ id: 'l1', label: 'L1', request: V().request, agentCommand: 'claude', folderConfigAtSave: [], createdAt: '' });
const ready = () => ({ kind: 'ready' as const, launcher: launcherL1(), validated: V() });

test('fix1: concurrent run links for one ready launcher yield one card, no spawn', async () => {
  const { gate, log } = make({ resolveRun: async () => ready() as any });
  await Promise.all([gate.handle(runLink('ready')), gate.handle(runLink('ready'))]);
  assert.equal(gate.list('main').length, 1);
  assert.equal(log.filter((l) => l.startsWith('launch:')).length, 0);
});

test('fix1: in-flight guard is released after completion', async () => {
  const { gate, advance } = make({ resolveRun: async () => ready() as any });
  await gate.handle(runLink('ready'));
  gate.discard(gate.list('main')[0].id);
  advance(LIMITS.burstWindowMs + 1);
  await gate.handle(runLink('ready'));
  assert.equal(gate.list('main').length, 1);
});

test('S6: a ready launcher starts only once its card is approved', async () => {
  const { gate, log } = make({ resolveRun: async () => ready() as any });
  await gate.handle(runLink('ready'));
  assert.ok(!log.some((l) => l.startsWith('launch:')));
  const [card] = gate.list('main');
  assert.deepEqual(await gate.approve(card.id), { ok: true });
  assert.ok(log.includes('launch:main:l1'));
});

test('fix2: approve refuses a stale pending card without tick()', async () => {
  const { gate, advance, log } = make();
  await gate.handle(newLink());
  const id = gate.list('main')[0].id;
  advance(LIMITS.expiryMs + 1);
  const n = log.length;
  assert.deepEqual(await gate.approve(id), { ok: false, error: 'This launch expired' });
  assert.equal(gate.list('main')[0].state, 'expired');
  assert.ok(log.slice(n).includes('changed:main:updated'));
  assert.ok(!log.some((l) => l.startsWith('launch:')));
});

test('fix3: a ready run link with a full cap is refused with a toast, not started', async () => {
  const { gate, log, advance } = make({
    resolveRun: async (id) => (id === 'ready' ? ready() : { kind: 'unknown' }) as any,
  });
  for (let i = 0; i < 5; i++) { await gate.handle(newLink({ prompt: `p${i}` })); advance(LIMITS.burstWindowMs); }
  await gate.handle(runLink('ready'));
  assert.equal(gate.list('main').length, 5);
  assert.ok(log.some((l) => l.includes('Too many pending launches')));
  assert.ok(!log.some((l) => l.startsWith('launch:')));
});

test('fix4: cap counts only non-expired entries', async () => {
  const { gate, advance } = make();
  for (let i = 0; i < 5; i++) { await gate.handle(newLink({ prompt: `p${i}` })); advance(LIMITS.burstWindowMs); }
  advance(LIMITS.expiryMs + 1);
  gate.tick();
  await gate.handle(newLink({ prompt: 'fresh' }));
  assert.equal(gate.list('main').length, 6);
  assert.equal(gate.list('main').filter((c) => c.state === 'pending').length, 1);
});

test('fix5: dedupe ignores request key order', async () => {
  const { gate } = make({ validate: async (req) => ({ ok: true, value: { ...V(), request: req } as any }) });
  await gate.handle({ ok: true, kind: 'new', request: { agent: 'claude', folder: '/tmp/p', flags: [], prompt: 'x' } } as any);
  await gate.handle({ ok: true, kind: 'new', request: { prompt: 'x', flags: [], folder: '/tmp/p', agent: 'claude' } } as any);
  assert.equal(gate.list('main').length, 1);
});

test('fix6: burst warning logs once per window', async () => {
  const orig = console.warn; let warns = 0;
  console.warn = () => { warns++; };
  try {
    const { gate } = make();
    for (let i = 0; i < 6; i++) await gate.handle(newLink({ prompt: `b${i}` }));
    assert.equal(warns, 1);
  } finally { console.warn = orig; }
});

test('fix7: notif links do not consume burst slots', async () => {
  const { gate } = make();
  for (let i = 0; i < 5; i++) await gate.handle({ ok: true, kind: 'notif', sessionId: 's' } as any);
  for (let i = 0; i < 3; i++) await gate.handle(newLink({ prompt: `n${i}` }));
  assert.equal(gate.list('main').length, 3);
});

test('fix8: non-Error throws still give a message', async () => {
  const { gate } = make({ launch: async () => { throw 'plain string'; } });
  await gate.handle(newLink());
  const id = gate.list('main')[0].id;
  assert.deepEqual(await gate.approve(id), { ok: false, error: 'plain string' });
  assert.equal(gate.list('main')[0].error, 'plain string');
});

test('fix9: retry after save ok + launch failure does not save twice', async () => {
  let fail = true; let saves = 0;
  const { gate } = make({
    saveLauncher: async () => { saves++; return { ok: true }; },
    launch: async () => { if (fail) throw new Error('boom'); return { id: 's' }; },
  });
  await gate.handle(newLink());
  const id = gate.list('main')[0].id;
  assert.equal((await gate.approve(id, { id: 'mine', label: 'M' })).ok, false);
  fail = false;
  assert.deepEqual(await gate.approve(id, { id: 'mine', label: 'M' }), { ok: true });
  assert.equal(saves, 1);
});

test('fix10: changed run card can update its own launcher (overwrite forced); other ids refused', async () => {
  const saved: any[] = [];
  const changedRes = { kind: 'changed', launcher: launcherL1(), validated: V({ warnings: [{ kind: 'launcher-changed', detail: 'x' }] }) };
  const { gate, log } = make({
    resolveRun: async () => changedRes as any,
    saveLauncher: async (i) => { saved.push(i); log.push(`save:${i.id}`); return { ok: true }; },
  });
  await gate.handle(runLink('l1'));
  const card = gate.list('main')[0];
  assert.equal(card.canSaveAsLauncher, false);
  assert.equal((await gate.approve(card.id, { id: 'other', label: 'O' })).ok, false);
  assert.equal(saved.length, 0);
  assert.deepEqual(await gate.approve(card.id, { id: 'l1', label: 'L1' }), { ok: true });
  assert.equal(saved[0].id, 'l1');
  assert.equal(saved[0].overwrite, true);
  assert.ok(log.indexOf('save:l1') < log.indexOf('launch:main:l1'));
});

test('fix11: ready launch failure on approve → card in error state with message', async () => {
  const { gate } = make({ resolveRun: async () => ready() as any, launch: async () => { throw new Error('nope'); } });
  await gate.handle(runLink('ready'));
  await gate.approve(gate.list('main')[0].id);
  const [card] = gate.list('main');
  assert.equal(card.state, 'error');
  assert.equal(card.error, 'nope');
  assert.equal(card.source, 'run');
});

test('fix11: saveLauncher failure → card back to pending with the error', async () => {
  const { gate, log } = make({ saveLauncher: async () => ({ ok: false, error: 'id taken' }) });
  await gate.handle(newLink());
  const id = gate.list('main')[0].id;
  assert.deepEqual(await gate.approve(id, { id: 'x', label: 'X' }), { ok: false, error: 'id taken' });
  const [card] = gate.list('main');
  assert.equal(card.state, 'pending');
  assert.equal(card.error, 'id taken');
  assert.ok(!log.some((l) => l.startsWith('launch:')));
});

test('fix11: second approve while starting is refused', async () => {
  let release!: () => void;
  const gateP = new Promise<void>((r) => { release = r; });
  const { gate, log } = make({ launch: async (_v, w) => { log2.push(w); await gateP; return { id: 's' }; } });
  const log2: string[] = [];
  await gate.handle(newLink());
  const id = gate.list('main')[0].id;
  const first = gate.approve(id);
  assert.deepEqual(await gate.approve(id), { ok: false, error: 'Already starting' });
  release();
  assert.deepEqual(await first, { ok: true });
  assert.equal(log2.length, 1);
  void log;
});

test('fix11: invalid run → danger toast', async () => {
  const { gate, log } = make({ resolveRun: async () => ({ kind: 'invalid', error: 'Folder does not exist' }) as any });
  await gate.handle(runLink('bad'));
  assert.ok(log.some((l) => l.startsWith('toast:main:danger:') && l.includes('Launcher "bad"')));
});

// ── F10: MCP start_session ───────────────────────────────────────────────────
const REQ = { sessionId: 'orch-1', name: 'Orchestrator' };
const mcpV = (prompt = 'build it') => V({ request: { flags: [], prompt } }) as any;

test('mcp request → pending card naming the requester; nothing starts until approved', async () => {
  const { gate, log } = make();
  const p = gate.request(mcpV(), REQ);
  const [card] = gate.list('main');
  assert.equal(card.source, 'mcp');
  assert.equal(card.requestedBy, 'Orchestrator');
  assert.equal(card.canSaveAsLauncher, false);
  assert.ok(!log.some((l) => l.startsWith('launch:')));
  assert.deepEqual(await gate.approve(card.id), { ok: true });
  assert.deepEqual(await p, { ok: true, sessionId: 'sess-new' });
});

test('mcp approve launches with the requester as spawnedBy', async () => {
  let by: string | undefined;
  const { gate } = make({ launch: async (_v, _w, _l, s) => { by = s; return { id: 'child' }; } });
  const p = gate.request(mcpV(), REQ);
  await gate.approve(gate.list('main')[0].id);
  assert.equal(by, 'orch-1');
  assert.deepEqual(await p, { ok: true, sessionId: 'child' });
});

test('mcp discard and expiry resolve the waiting call with an error', async () => {
  const { gate, advance } = make();
  const discarded = gate.request(mcpV('a'), REQ);
  gate.discard(gate.list('main')[0].id);
  assert.deepEqual(await discarded, { ok: false, error: 'The user discarded this launch in Argus' });

  const expiring = gate.request(mcpV('b'), REQ);
  advance(LIMITS.expiryMs + 1);
  gate.tick();
  const r = await expiring;
  assert.equal(r.ok, false);
});

test('identical MCP requests are separate cards with separate answers (two workers)', async () => {
  let n = 0;
  const { gate } = make({ launch: async () => ({ id: `child-${++n}` }) });
  const a = gate.request(mcpV(), REQ);
  const b = gate.request(mcpV(), REQ);
  const cards = gate.list('main');
  assert.equal(cards.length, 2);
  await gate.approve(cards[0].id);
  await gate.approve(cards[1].id);
  assert.notDeepEqual(await a, await b);
});

test('a failed launch answers the waiting call; Retry stays on the card', async () => {
  const { gate } = make({ launch: async () => { throw new Error('worktree base not found'); } });
  const p = gate.request(mcpV(), REQ);
  const r = await gate.approve(gate.list('main')[0].id);
  assert.equal(r.ok, false);
  assert.deepEqual(await p, { ok: false, error: 'Launch failed: worktree base not found' });
  assert.equal(gate.list('main')[0].state, 'error');
});

test('an aborted call withdraws its pending card', async () => {
  const { gate } = make();
  const ac = new AbortController();
  const p = gate.request(mcpV(), REQ, ac.signal);
  assert.equal(gate.list('main').length, 1);
  ac.abort();
  assert.deepEqual(await p, { ok: false, error: 'Cancelled' });
  assert.equal(gate.list('main').length, 0);
});

test('MCP cards have their own cap and never crowd out links', async () => {
  const { gate } = make();
  for (let i = 0; i < LIMITS.maxPendingMcp; i++) void gate.request(mcpV(`w${i}`), REQ);
  const over = await gate.request(mcpV('over'), REQ);
  assert.equal(over.ok, false);
  await gate.handle(newLink());
  assert.equal(gate.list('main').filter((c) => c.source === 'new').length, 1);
});

test('trusted MCP starts do not use up the deep-link burst budget', async () => {
  const { gate } = make();
  const first = gate.request(mcpV('p0'), REQ);
  await gate.approve(gate.list('main')[0].id, undefined, true);
  await first;
  for (let i = 1; i <= LIMITS.burstCount; i++) await gate.request(mcpV(`p${i}`), REQ);
  await gate.handle(newLink());
  assert.equal(gate.list('main').filter((c) => c.source === 'new').length, 1);
});

test('trust ("don’t ask again") starts later requests from that session without a card', async () => {
  const { gate, log } = make();
  const first = gate.request(mcpV('one'), REQ);
  await gate.approve(gate.list('main')[0].id, undefined, true);
  await first;
  const second = await gate.request(mcpV('two'), REQ);
  assert.deepEqual(second, { ok: true, sessionId: 'sess-new' });
  assert.equal(gate.list('main').length, 0, 'no card for a trusted requester');
  assert.ok(log.some((l) => l.startsWith('toast:main:ok:Started')));
  // Another session is still asked.
  void gate.request(mcpV('three'), { sessionId: 'orch-2', name: 'Other' });
  assert.equal(gate.list('main').length, 1);
});

test('a trusted requester past the burst limit is back to a card', async () => {
  const { gate } = make();
  const first = gate.request(mcpV('p0'), REQ);
  await gate.approve(gate.list('main')[0].id, undefined, true);
  await first;
  for (let i = 1; i <= LIMITS.burstCount; i++) await gate.request(mcpV(`p${i}`), REQ);
  void gate.request(mcpV('over'), REQ);
  assert.equal(gate.list('main').length, 1);
});

test('trust is refused for a non-MCP card', async () => {
  const { gate } = make();
  await gate.handle(newLink());
  const r = await gate.approve(gate.list('main')[0].id, undefined, true);
  assert.equal(r.ok, false);
});
