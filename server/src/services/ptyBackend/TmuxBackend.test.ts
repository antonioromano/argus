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
