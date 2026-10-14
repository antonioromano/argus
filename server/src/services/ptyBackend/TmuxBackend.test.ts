import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TmuxBackend, WHEEL_COALESCE_MS } from './TmuxBackend.js';

function fakePty(sendDelayMs = 0) {
  const sent: string[] = [];
  let active = 0;
  let overlap = false;
  const pm = {
    isTmuxAvailable: () => true,
    sendKeysLiteral: async (_name: string, data: string) => {
      if (active > 0) overlap = true;
      active++;
      sent.push(data);
      await new Promise((r) => setTimeout(r, sendDelayMs));
      active--;
    },
  };
  return { pm: pm as any, sent, overlap: () => overlap };
}

const UP = '\x1b[<64;1;1M';
const DOWN = '\x1b[<65;1;1M';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('first wheel report goes out synchronously; a burst after it becomes one send', async () => {
  const { pm, sent } = fakePty();
  const b = new TmuxBackend(pm);
  b.writeWheel('s1', {} as any, UP);
  assert.deepEqual(sent, [UP], 'leading report is not delayed');
  b.writeWheel('s1', {} as any, UP);
  b.writeWheel('s1', {} as any, DOWN);
  b.writeWheel('s1', {} as any, UP);
  assert.equal(sent.length, 1, 'reports inside the window are held');
  await wait(WHEEL_COALESCE_MS * 3);
  assert.deepEqual(sent, [UP, UP + DOWN + UP], 'held reports are sent once, in order');
});

test('sends for one session never overlap, and sessions are batched separately', async () => {
  const { pm, sent, overlap } = fakePty(WHEEL_COALESCE_MS * 2);
  const b = new TmuxBackend(pm);
  b.writeWheel('a', {} as any, UP);
  b.writeWheel('b', {} as any, DOWN);
  b.writeWheel('a', {} as any, DOWN);
  await wait(WHEEL_COALESCE_MS * 8);
  assert.deepEqual(sent.slice(0, 2), [UP, DOWN]);
  assert.deepEqual(sent.slice(2), [DOWN]);
  assert.equal(overlap(), true, 'different sessions may run concurrently');
});

test('a failing send-keys is swallowed (session may be gone)', async () => {
  const pm = { isTmuxAvailable: () => true, sendKeysLiteral: async () => { throw new Error('gone'); } } as any;
  const b = new TmuxBackend(pm);
  b.writeWheel('s', {} as any, UP);
  await wait(WHEEL_COALESCE_MS * 2);
});

test('without tmux the report is written to the pty', () => {
  const writes: string[] = [];
  const b = new TmuxBackend({ isTmuxAvailable: () => false } as any);
  b.writeWheel('s', { write: (d: string) => writes.push(d) } as any, UP);
  assert.deepEqual(writes, [UP]);
});

// --- restore: one list-panes -a per poll, not two forks per survivor (P4) ---

function restorePty(panes: Record<string, { dead: boolean; alternate: boolean }>) {
  const calls: string[] = [];
  const pm = {
    isTmuxAvailable: () => true,
    listPaneStates: () => {
      calls.push('list-panes -a');
      return new Map(Object.entries(panes));
    },
    isTmuxPaneDead: (name: string) => {
      calls.push(`pane_dead ${name}`);
      return panes[name]?.dead ?? false;
    },
    captureState: (name: string) => {
      calls.push(`display ${name}`);
      return { cursorX: 0, cursorY: 0, alternate: panes[name]?.alternate ?? false, appMouse: false, sgr: true };
    },
    capturePane: () => '',
    killTmuxSession: (name: string) => calls.push(`kill ${name}`),
  };
  return { pm: pm as any, calls };
}

test('restore answers every survivor from a single list-panes -a', async () => {
  const { pm, calls } = restorePty({
    'argus-a': { dead: false, alternate: false },
    'argus-b': { dead: true, alternate: false },
    'argus-c': { dead: false, alternate: true },
  });
  const b = new TmuxBackend(pm);
  const ids = await b.listSurvivors();
  assert.deepEqual([...ids].sort(), ['a', 'b', 'c']);
  assert.equal(b.isSurvivorDead('a'), false);
  assert.equal(b.isSurvivorDead('b'), true);
  assert.equal(b.isSurvivorDead('c'), false);
  const mirror = { markSeeding() {}, clearSeeding() {}, feed: async () => {} } as any;
  for (const id of ['a', 'b', 'c']) b.seedMirror(id, mirror);
  assert.deepEqual(calls, ['list-panes -a'], 'no per-session tmux forks during the restore');
});

test('a session missing from the snapshot, or a stale snapshot, asks tmux directly', async () => {
  const { pm, calls } = restorePty({ 'argus-a': { dead: false, alternate: false } });
  const b = new TmuxBackend(pm);
  await b.listSurvivors();
  b.isSurvivorDead('new');
  assert.deepEqual(calls, ['list-panes -a', 'pane_dead argus-new']);

  calls.length = 0;
  (b as any).paneSnapshot.at -= 60_000; // long after the restore
  b.isSurvivorDead('a');
  assert.deepEqual(calls, ['pane_dead argus-a']);
});

test('stopping a session drops it from the snapshot (a respawn is a different pane)', async () => {
  const { pm, calls } = restorePty({ 'argus-a': { dead: true, alternate: false } });
  const b = new TmuxBackend(pm);
  await b.listSurvivors();
  b.stopSession('a');
  calls.length = 0;
  b.isSurvivorDead('a');
  assert.deepEqual(calls, ['pane_dead argus-a']);
});
