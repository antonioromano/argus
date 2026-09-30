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
    changed: (w) => log.push(`changed:${w}`),
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
  assert.ok(log.includes('changed:main'));
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

test('run: unknown → toast; live → highlight, no spawn; ready → direct launch + toast; changed → card', async () => {
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
  assert.ok(log.includes('launch:main:l1'));
  assert.ok(log.some((l) => l.startsWith('toast:main:ok:Started L1')));
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

test('unknown id: approve refused, has() false', async () => {
  const { gate } = make();
  assert.equal(gate.has('nope'), false);
  assert.equal((await gate.approve('nope')).ok, false);
});
