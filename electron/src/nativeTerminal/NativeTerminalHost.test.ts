import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeTerminalHost } from './NativeTerminalHost.js';
import type { HostDeps, NativeTerminalAddon } from './types.js';

function fakeAddon() {
  const calls: string[] = [];
  let next = 1;
  let inputCb: ((id: number, d: Buffer) => void) | undefined;
  let resizeCb: ((id: number, c: number, r: number) => void) | undefined;
  // Set a flag to true to make the *next* call to that method throw once,
  // then auto-reset — lets a test inject a single fault mid-sequence.
  const failNext: Partial<Record<'create' | 'feed' | 'setFrame', boolean>> = {};
  const addon: NativeTerminalAddon = {
    create: () => {
      calls.push(`create:${next}`);
      if (failNext.create) { failNext.create = false; throw new Error('create failed'); }
      return next++;
    },
    setFrame: (id, x, y, w, h) => {
      calls.push(`setFrame:${id}:${x},${y},${w},${h}`);
      if (failNext.setFrame) { failNext.setFrame = false; throw new Error('setFrame failed'); }
    },
    show: (id) => calls.push(`show:${id}`),
    hide: (id) => calls.push(`hide:${id}`),
    destroy: (id) => calls.push(`destroy:${id}`),
    feed: (id, d) => {
      calls.push(`feed:${id}:${d.toString()}`);
      if (failNext.feed) { failNext.feed = false; throw new Error('feed failed'); }
    },
    clearScrollback: (id) => calls.push(`clear:${id}`),
    onInput: (cb) => { inputCb = cb; },
    onResize: (cb) => { resizeCb = cb; },
  };
  return { addon, calls, failNext, fireInput: (i: number, s: string) => inputCb!(i, Buffer.from(s)),
           fireResize: (i: number, c: number, r: number) => resizeCb!(i, c, r) };
}

function harness(
  addonOrNull: NativeTerminalAddon | null,
  snapshot: { data: string; alternate: boolean } = { data: 'REPLAY', alternate: false },
  overrides: Partial<HostDeps> = {},
) {
  const wrote: Array<[string, string]> = [];
  const resized: Array<[string, number, number]> = [];
  let emit: ((id: string, data: string) => void) | undefined;
  const host = new NativeTerminalHost({
    addon: addonOrNull,
    onOutput: (cb) => { emit = cb; return () => { emit = undefined; }; },
    writeToSession: (id, d) => wrote.push([id, d]),
    resizeSession: (id, c, r) => resized.push([id, c, r]),
    getReplaySnapshot: () => snapshot,
    ...overrides,
  });
  return { host, wrote, resized, emitOutput: (id: string, d: string) => emit?.(id, d) };
}

const HANDLE = Buffer.alloc(8);
const RECT = { x: 10, y: 20, width: 300, height: 200 };

test('attach creates an overlay and seeds it with the replay frame', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  assert.ok(calls.includes('create:1'));
  assert.ok(calls.includes('feed:1:REPLAY'), `expected replay seed, got ${calls.join(',')}`);
  assert.ok(calls.includes('setFrame:1:10,20,300,200'));
});

test('an alt-screen session is seeded onto the alternate buffer', () => {
  // A session already inside vim/htop must not have its alt-screen content
  // painted into the normal buffer — the view would show a garbled mix until
  // the next full repaint.
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon, { data: 'VIMSCREEN', alternate: true });
  host.attach('s1', HANDLE, RECT);
  const fed = calls.filter((c) => c.startsWith('feed:1:')).join('|');
  assert.ok(fed.includes('\x1b[?1049h'), `expected an alt-buffer switch before the seed, got ${fed}`);
  assert.ok(fed.includes('VIMSCREEN'));
});

test('a normal-screen session is seeded without an alt-buffer switch', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon, { data: 'PLAIN', alternate: false });
  host.attach('s1', HANDLE, RECT);
  const fed = calls.filter((c) => c.startsWith('feed:1:')).join('|');
  assert.ok(fed.includes('PLAIN'));
  assert.ok(!fed.includes('\x1b[?1049h'), 'must not switch buffers for a normal-screen session');
});

test('session output is fed only to that session overlay', () => {
  const { addon, calls } = fakeAddon();
  const { host, emitOutput } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.attach('s2', HANDLE, RECT);
  emitOutput('s1', 'abc');
  assert.ok(calls.includes('feed:1:abc'));
  assert.ok(!calls.includes('feed:2:abc'));
});

test('output for an unattached session is ignored', () => {
  const { addon, calls } = fakeAddon();
  const { host, emitOutput } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  const before = calls.length;
  emitOutput('other', 'zzz');
  assert.equal(calls.length, before);
});

test('user input is routed back to the right session', () => {
  const { addon, fireInput } = fakeAddon();
  const { host, wrote } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  fireInput(1, 'ls\r');
  assert.deepEqual(wrote, [['s1', 'ls\r']]);
});

test('native resize drives the pty — native is the resize authority', () => {
  const { addon, fireResize } = fakeAddon();
  const { host, resized } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  fireResize(1, 120, 40);
  assert.deepEqual(resized, [['s1', 120, 40]]);
});

test('detach destroys the overlay and stops feeding it', () => {
  const { addon, calls } = fakeAddon();
  const { host, emitOutput } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.detach('s1');
  assert.ok(calls.includes('destroy:1'));
  const before = calls.length;
  emitOutput('s1', 'after');
  assert.equal(calls.length, before, 'must not feed a destroyed overlay');
});

test('hide keeps the overlay alive; show reuses it rather than recreating', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.hide('s1');
  host.show('s1');
  assert.ok(calls.includes('hide:1'));
  assert.ok(calls.includes('show:1'));
  assert.equal(calls.filter((c) => c.startsWith('create:')).length, 1);
});

test('with no addon the host is unavailable and every call is inert', () => {
  const { host, wrote } = harness(null);
  assert.equal(host.isAvailable(), false);
  host.attach('s1', HANDLE, RECT);   // must not throw
  host.setRect('s1', RECT);
  host.detach('s1');
  assert.deepEqual(wrote, []);
});

test('attaching twice reuses the existing overlay', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.attach('s1', HANDLE, { x: 1, y: 2, width: 9, height: 9 });
  assert.equal(calls.filter((c) => c.startsWith('create:')).length, 1);
  assert.ok(calls.includes('setFrame:1:1,2,9,9'));
});

// --- JS/native boundary guards -------------------------------------------
// Every call across the boundary must degrade rather than throw: a failure
// from the addon must not leave bySession/byOverlay inconsistent, and a
// failure from a HostDeps callback invoked off a native dispatch must not
// escape into that dispatch.

test('an addon whose create() throws leaves no half-registered overlay, and a later attach can still succeed', () => {
  const { addon, calls, failNext } = fakeAddon();
  const { host } = harness(addon);
  failNext.create = true;
  host.attach('s1', HANDLE, RECT);                 // must not throw
  assert.ok(!calls.some((c) => c.startsWith('setFrame:')), 'must not configure a non-existent overlay');
  host.detach('s1');                               // nothing registered — must not call destroy
  assert.ok(!calls.some((c) => c.startsWith('destroy:')));
  host.attach('s1', HANDLE, RECT);                 // retry succeeds cleanly
  assert.ok(calls.includes('create:1'));
  assert.ok(calls.includes('setFrame:1:10,20,300,200'));
});

test('a setFrame failure after a successful create keeps the overlay registered', () => {
  const { addon, calls, failNext } = fakeAddon();
  const { host } = harness(addon);
  failNext.setFrame = true;
  host.attach('s1', HANDLE, RECT);                 // create succeeds, setFrame throws — must not throw out
  assert.ok(calls.includes('create:1'));
  calls.length = 0;
  host.show('s1');                                 // overlay still reachable — no re-create needed
  assert.deepEqual(calls, ['show:1']);
});

test('a throwing writeToSession does not propagate out of the onInput callback', () => {
  const { addon, fireInput } = fakeAddon();
  const { host } = harness(addon, undefined, { writeToSession: () => { throw new Error('session gone'); } });
  host.attach('s1', HANDLE, RECT);
  assert.doesNotThrow(() => fireInput(1, 'ls\r'));
});

test('a throwing resizeSession does not propagate out of the onResize callback', () => {
  const { addon, fireResize } = fakeAddon();
  const { host } = harness(addon, undefined, { resizeSession: () => { throw new Error('session gone'); } });
  host.attach('s1', HANDLE, RECT);
  assert.doesNotThrow(() => fireResize(1, 120, 40));
});

test('a throwing addon.feed does not propagate out of the onOutput subscriber', () => {
  const { addon, calls, failNext } = fakeAddon();
  const { host, emitOutput } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  failNext.feed = true;
  assert.doesNotThrow(() => emitOutput('s1', 'abc'));
  assert.ok(calls.includes('feed:1:abc'));
});
