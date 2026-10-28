import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

// Chat view (B1): submitting a message and switching the permission mode both
// write to the pty and then read the settled screen (applyFooter rows).

function fixture() {
  const configStore = { load: async () => ({}), save: async () => {} } as any;
  const sm = new SessionManager(os.tmpdir(), configStore);
  const emitted: Array<{ event: string; payload: any }> = [];
  (sm as any).io = { to: () => ({ emit: (event: string, payload: any) => emitted.push({ event, payload }) }), emit: () => {} };
  (sm as any).sessions.set('s', {
    id: 's', name: 's', folderPath: os.tmpdir(), agentType: 'claude', flags: [], status: 'idle', createdAt: new Date().toISOString(), chatViewers: 1,
  });
  const writes: Array<[string, number | undefined]> = [];
  const write = (data: string, pause?: number) => writes.push([data, pause]);
  const settle = (rows: string[]) => (sm as any).applyFooter('s', rows);
  const tick = () => new Promise((r) => setImmediate(r));
  return { sm, emitted, writes, write, settle, tick };
}

test('submit: text, then Enter after a pause; done once the input box is empty', async () => {
  const f = fixture();
  const p = f.sm.submitChatInput('s', 'hello', f.write);
  assert.deepEqual(f.writes, [['hello', 60], ['\r', undefined]]);
  f.settle(['❯ hello', '──', '❯ ', '──']);
  assert.equal(await p, true);
  assert.equal(f.writes.length, 2, 'no extra Enter');
});

test('submit: Enter is pressed again while the text is still in the input box', async () => {
  const f = fixture();
  const p = f.sm.submitChatInput('s', '/model claude-opus-5-5', f.write);
  f.settle(['──', '❯ /model claude-opus-5-5', '──']);
  await f.tick();
  assert.deepEqual(f.writes.at(-1), ['\r', undefined]);
  assert.equal(f.writes.length, 3);
  f.settle(['  ⎿  Set model to Opus 5.5', '──', '❯ ', '──']);
  assert.equal(await p, true);
  assert.equal(f.writes.length, 3);
});

test('submit: multi-line text is pasted; empty or exited is refused', async () => {
  const f = fixture();
  const p = f.sm.submitChatInput('s', 'a\nb', f.write);
  assert.equal(f.writes[0][0], '\x1b[200~a\nb\x1b[201~');
  f.settle(['❯ ']);
  await p;
  assert.equal(await f.sm.submitChatInput('s', '   ', f.write), false);
  (f.sm as any).sessions.get('s').status = 'exited';
  assert.equal(await f.sm.submitChatInput('s', 'hi', f.write), false);
});

test('submit: a stopped prompt left in the input box is cleared before typing (F3)', async () => {
  const f = fixture();
  const first = f.sm.submitChatInput('s', 'wait 5 seconds', f.write);
  f.settle(['❯ ']);
  await first;
  // Stop: Claude Code put the prompt back into its input box.
  f.settle(['──', '❯ wait 5 seconds', '──']);
  f.writes.length = 0;
  const p = f.sm.submitChatInput('s', 'next one', f.write);
  assert.deepEqual(f.writes, [['\x03', undefined]]);
  f.settle(['──', '❯ ', '──']);
  await f.tick();
  assert.deepEqual(f.writes.slice(1), [['next one', 60], ['\r', undefined]]);
  f.settle(['❯ ']);
  assert.equal(await p, true);
});

test('submit: text the chat did not send, or a running turn, is never cleared', async () => {
  const f = fixture();
  f.settle(['──', '❯ typed in the terminal', '──']);
  const a = f.sm.submitChatInput('s', 'hello', f.write);
  assert.equal(f.writes[0][0], 'hello');
  f.settle(['❯ ']);
  await a;
  f.settle(['──', '❯ hello', '──']);
  (f.sm as any).sessions.get('s').status = 'running';
  f.writes.length = 0;
  const b = f.sm.submitChatInput('s', 'queued', f.write);
  assert.equal(f.writes[0][0], 'queued');
  f.settle(['❯ ']);
  await b;
});

test('mode: footer changes are pushed to chat viewers; Shift+Tab until the target shows', async () => {
  const f = fixture();
  f.settle(['  ⏵⏵ auto mode on (shift+tab to cycle)']);
  assert.deepEqual(f.emitted.at(-1), { event: 'session:chatMode', payload: { sessionId: 's', permissionMode: 'auto' } });

  const p = f.sm.setPermissionMode('s', 'acceptEdits', f.write);
  assert.deepEqual(f.writes, [['\x1b[Z', undefined]]);
  f.settle(['  ⏸ manual mode on']);
  await f.tick();
  assert.equal(f.writes.length, 2);
  f.settle(['  ⏵⏵ accept edits on (shift+tab to cycle)']);
  assert.equal(await p, true);
  assert.equal(f.writes.length, 2);
});

test('mode: refused for unknown modes and while waiting', async () => {
  const f = fixture();
  assert.equal(await f.sm.setPermissionMode('s', 'yolo', f.write), false);
  (f.sm as any).sessions.get('s').status = 'waiting';
  assert.equal(await f.sm.setPermissionMode('s', 'plan', f.write), false);
  assert.equal(f.writes.length, 0);
});
