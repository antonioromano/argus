import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeTerminalHost } from './NativeTerminalHost.js';
import type { NativeTerminalAddon } from './types.js';

function fakeAddon() {
  const calls: string[] = [];
  let next = 1;
  let inputCb: ((id: number, d: Buffer) => void) | undefined;
  let resizeCb: ((id: number, c: number, r: number) => void) | undefined;
  const addon: NativeTerminalAddon = {
    create: () => { calls.push(`create:${next}`); return next++; },
    setFrame: (id, x, y, w, h) => calls.push(`setFrame:${id}:${x},${y},${w},${h}`),
    show: (id) => calls.push(`show:${id}`),
    hide: (id) => calls.push(`hide:${id}`),
    destroy: (id) => calls.push(`destroy:${id}`),
    feed: (id, d) => calls.push(`feed:${id}:${d.toString()}`),
    clearScrollback: (id) => calls.push(`clear:${id}`),
    onInput: (cb) => { inputCb = cb; },
    onResize: (cb) => { resizeCb = cb; },
  };
  return { addon, calls, fireInput: (i: number, s: string) => inputCb!(i, Buffer.from(s)),
           fireResize: (i: number, c: number, r: number) => resizeCb!(i, c, r) };
}

function harness(addonOrNull: NativeTerminalAddon | null) {
  const wrote: Array<[string, string]> = [];
  const resized: Array<[string, number, number]> = [];
  let emit: ((id: string, data: string) => void) | undefined;
  const host = new NativeTerminalHost({
    addon: addonOrNull,
    onOutput: (cb) => { emit = cb; return () => { emit = undefined; }; },
    writeToSession: (id, d) => wrote.push([id, d]),
    resizeSession: (id, c, r) => resized.push([id, c, r]),
    getReplaySnapshot: () => ({ data: 'REPLAY' }),
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
