import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeTerminalHost } from './NativeTerminalHost.js';
import type { HostDeps, NativeTerminalAddon } from './types.js';

function fakeAddon() {
  const calls: string[] = [];
  let next = 1;
  let inputCb: ((id: number, d: Buffer) => void) | undefined;
  let resizeCb: ((id: number, c: number, r: number) => void) | undefined;
  let focusCb: ((id: number, focused: boolean) => void) | undefined;
  let openLinkCb: ((id: number, url: string) => void) | undefined;
  // Set a flag to true to make the *next* call to that method throw once,
  // then auto-reset — lets a test inject a single fault mid-sequence.
  const failNext: Partial<Record<'create' | 'feed' | 'setFrame' | 'setTheme' | 'reparent' | 'openFindBar', boolean>> = {};
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
    setTheme: (id, bg, fg, cursor, ansi) => {
      calls.push(`setTheme:${id}:${bg},${fg},${cursor},${ansi.length}`);
      if (failNext.setTheme) { failNext.setTheme = false; throw new Error('setTheme failed'); }
    },
    reparent: (id) => {
      calls.push(`reparent:${id}`);
      if (failNext.reparent) { failNext.reparent = false; throw new Error('reparent failed'); }
    },
    show: (id) => calls.push(`show:${id}`),
    hide: (id) => calls.push(`hide:${id}`),
    destroy: (id) => calls.push(`destroy:${id}`),
    feed: (id, d) => {
      calls.push(`feed:${id}:${d.toString()}`);
      if (failNext.feed) { failNext.feed = false; throw new Error('feed failed'); }
    },
    clearScrollback: (id) => calls.push(`clear:${id}`),
    openFindBar: (id) => {
      calls.push(`openFindBar:${id}`);
      if (failNext.openFindBar) { failNext.openFindBar = false; throw new Error('openFindBar failed'); }
    },
    closeFindBar: (id) => calls.push(`closeFindBar:${id}`),
    onInput: (cb) => { inputCb = cb; },
    onResize: (cb) => { resizeCb = cb; },
    onFocus: (cb) => { focusCb = cb; },
    onOpenLink: (cb) => { openLinkCb = cb; },
  };
  return { addon, calls, failNext, fireInput: (i: number, s: string) => inputCb!(i, Buffer.from(s)),
           fireResize: (i: number, c: number, r: number) => resizeCb!(i, c, r),
           fireFocus: (i: number, f: boolean) => focusCb!(i, f),
           fireOpenLink: (i: number, u: string) => openLinkCb!(i, u) };
}

function harness(addonOrNull: NativeTerminalAddon | null, overrides: Partial<HostDeps> = {}) {
  const wrote: Array<[string, string]> = [];
  const resized: Array<[string, number, number]> = [];
  const focused: Array<[string, boolean]> = [];
  const opened: string[] = [];
  let emit: ((id: string, data: string) => void) | undefined;
  const host = new NativeTerminalHost({
    addon: addonOrNull,
    onOutput: (cb) => { emit = cb; return () => { emit = undefined; }; },
    writeToSession: (id, d) => wrote.push([id, d]),
    resizeSession: (id, c, r) => resized.push([id, c, r]),
    notifyFocus: (id, f) => focused.push([id, f]),
    openExternal: (u) => opened.push(u),
    getReplaySnapshot: () => ({ data: 'REPLAY' }),
    ...overrides,
  });
  return { host, wrote, resized, focused, opened, emitOutput: (id: string, d: string) => emit?.(id, d) };
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

test('the replay frame is fed verbatim — it already self-normalizes the buffer state', () => {
  // SessionManager.getReplaySnapshot's frame always leads with its own
  // reconcile prefix (\x1b[?1049l\x1b[2J\x1b[3J\x1b[H, forcing the normal
  // buffer and clearing it) and mirror.serialize() re-emits ?1049h itself
  // when the session is on the alt screen. So a frame from a session sitting
  // in vim/htop looks like '\x1b[?1049l...\x1b[?1049h<screen>' — any wrapper
  // here would either be cancelled by the leading 1049l (a no-op) or, worse,
  // land in the wrong place and corrupt the reconcile. The host must not
  // rewrite this in any way.
  const REALISTIC_FRAME = '\x1b[?1049l\x1b[2J\x1b[3J\x1b[H\x1b[?1049hVIMSCREEN';
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon, { getReplaySnapshot: () => ({ data: REALISTIC_FRAME }) });
  host.attach('s1', HANDLE, RECT);
  assert.ok(calls.includes(`feed:1:${REALISTIC_FRAME}`), `expected the frame fed verbatim, got ${calls.join(',')}`);
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

test('attaching a session to a different window reparents its overlay', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  const winB = Buffer.alloc(8, 2);
  host.attach('s1', winA, RECT);
  host.attach('s1', winB, RECT);
  assert.equal(calls.filter((c) => c.startsWith('create:')).length, 1, 'must not create a second overlay');
  assert.ok(calls.some((c) => c.startsWith('reparent:1')), `expected a reparent, got ${calls.join(',')}`);
});

test('re-attaching to the SAME window does not reparent', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  host.attach('s1', winA, RECT);
  host.attach('s1', winA, RECT);
  assert.ok(!calls.some((c) => c.startsWith('reparent:')), 'a same-window re-attach is just a setFrame');
});

test('a failing reparent leaves parentBySession unchanged, so the next attach retries', () => {
  const { addon, calls, failNext } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  const winB = Buffer.alloc(8, 2);
  host.attach('s1', winA, RECT);
  failNext.reparent = true;
  host.attach('s1', winB, RECT);                   // reparent throws — must not throw out
  assert.equal(calls.filter((c) => c.startsWith('reparent:')).length, 1, 'first reparent attempt');
  host.attach('s1', winB, RECT);                    // still believes it's on winA — must retry
  assert.equal(calls.filter((c) => c.startsWith('reparent:')).length, 2,
    `expected a second reparent attempt after the first failed, got ${calls.join(',')}`);
});

test('a successful reparent records the new parent, so a repeat attach does not reparent again', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  const winB = Buffer.alloc(8, 2);
  host.attach('s1', winA, RECT);
  host.attach('s1', winB, RECT);                    // reparent succeeds
  host.attach('s1', winB, RECT);                    // same window again — no-op
  assert.equal(calls.filter((c) => c.startsWith('reparent:')).length, 1,
    `expected exactly one reparent call total, got ${calls.join(',')}`);
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
  const { host } = harness(addon, { writeToSession: () => { throw new Error('session gone'); } });
  host.attach('s1', HANDLE, RECT);
  assert.doesNotThrow(() => fireInput(1, 'ls\r'));
});

test('a throwing resizeSession does not propagate out of the onResize callback', () => {
  const { addon, fireResize } = fakeAddon();
  const { host } = harness(addon, { resizeSession: () => { throw new Error('session gone'); } });
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

test('detach is idempotent and safe for a session that already exited', () => {
  // Session exit and tile unmount can both fire; neither must throw or
  // double-destroy.
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.detach('s1');
  host.detach('s1');
  assert.equal(calls.filter((c) => c.startsWith('destroy:')).length, 1);
});

// --- attach() result: lets the caller fall back to xterm.js --------------

test('attach reports failure when create throws', () => {
  const { addon } = fakeAddon();
  addon.create = () => { throw new Error('no window'); };
  const { host } = harness(addon);
  assert.equal(host.attach('s1', HANDLE, RECT), false);
});

test('attach reports success on the happy path and on reuse', () => {
  const { addon } = fakeAddon();
  const { host } = harness(addon);
  assert.equal(host.attach('s1', HANDLE, RECT), true);
  assert.equal(host.attach('s1', HANDLE, RECT), true);
});

test('attach reports failure when the addon is unavailable', () => {
  const { host } = harness(null);
  assert.equal(host.attach('s1', HANDLE, RECT), false);
});

test('attach reports success even when a post-create call fails — the overlay is still live', () => {
  const { addon, failNext } = fakeAddon();
  const { host } = harness(addon);
  failNext.setFrame = true;
  assert.equal(host.attach('s1', HANDLE, RECT), true);
});

// --- window-scoped detach/hide/show (Phase 2 final fix) -------------------
// A session can move between Argus windows (reparent above). A renderer-
// initiated detach/hide/show must be scoped to the window making the request:
// a stale call from a session's OLD window must not touch the overlay its
// NEW window just acquired. Calls with no window context (session deleted,
// app quit, a window's own 'closed' handler) must remain unconditional.

test('a detach from a window that is no longer the session\'s parent is ignored', () => {
  const { addon, calls } = fakeAddon();
  const { host, emitOutput } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  const winB = Buffer.alloc(8, 2);
  host.attach('s1', winA, RECT);
  host.attach('s1', winB, RECT);           // reparented to B — A is stale now
  const detached = host.detach('s1', winA); // stale detach from A
  assert.equal(detached, false, 'must report that it did not detach');
  assert.ok(!calls.includes('destroy:1'), `expected stale detach to be ignored, got ${calls.join(',')}`);
  // Still tracked and live: output keeps feeding the overlay B owns.
  calls.length = 0;
  emitOutput('s1', 'still-alive');
  assert.ok(calls.includes('feed:1:still-alive'), 'session must still be tracked after the ignored detach');
});

test('a detach from the current parent works', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  const winB = Buffer.alloc(8, 2);
  host.attach('s1', winA, RECT);
  host.attach('s1', winB, RECT);
  const detached = host.detach('s1', winB);
  assert.equal(detached, true);
  assert.ok(calls.includes('destroy:1'), `expected detach from current parent to work, got ${calls.join(',')}`);
});

test('an unconditional detach (no window context) still works regardless of parent', () => {
  // Mirrors onSessionDeleted / dispose() / a window's own 'closed' handler —
  // none of these have a requesting window to check, and all must still
  // tear the overlay down no matter which window currently owns it.
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  const winB = Buffer.alloc(8, 2);
  host.attach('s1', winA, RECT);
  host.attach('s1', winB, RECT);
  const detached = host.detach('s1');      // no parent arg — must destroy regardless
  assert.equal(detached, true);
  assert.ok(calls.includes('destroy:1'));
});

test('hide/show from a non-parent window are ignored', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  const winB = Buffer.alloc(8, 2);
  host.attach('s1', winA, RECT);
  host.attach('s1', winB, RECT);           // attach() itself calls addon.show — clear before probing
  calls.length = 0;
  host.hide('s1', winA);
  host.show('s1', winA);
  assert.ok(!calls.includes('hide:1'), `expected stale hide to be ignored, got ${calls.join(',')}`);
  assert.ok(!calls.includes('show:1'), `expected stale show to be ignored, got ${calls.join(',')}`);
});

test('hide/show from the current parent still work', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  const winB = Buffer.alloc(8, 2);
  host.attach('s1', winA, RECT);
  host.attach('s1', winB, RECT);
  host.hide('s1', winB);
  host.show('s1', winB);
  assert.ok(calls.includes('hide:1'));
  assert.ok(calls.includes('show:1'));
});

// --- openFindBar / closeFindBar / clearScrollback --------------------------
// task-6's reversal: the renderer no longer sends a search term across the
// boundary (see NativeTerminalHost.openFindBar's doc comment) — it only
// toggles SwiftTerm's own find bar. Renamed from search()/clearSearch().

test('openFindBar on an unattached session is a no-op that does not throw', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  assert.doesNotThrow(() => host.openFindBar('never-attached'));
  assert.equal(calls.length, 0, 'must not reach the addon for an unknown session');
});

test('openFindBar delegates to the addon', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.openFindBar('s1');
  assert.ok(calls.includes('openFindBar:1'));
});

test('a throwing addon.openFindBar does not propagate', () => {
  const { addon, failNext } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  failNext.openFindBar = true;
  assert.doesNotThrow(() => host.openFindBar('s1'));
});

test('openFindBar with no addon is inert', () => {
  const { host } = harness(null);
  assert.doesNotThrow(() => host.openFindBar('s1'));
});

test('closeFindBar on an unattached session is a no-op that does not throw', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  assert.doesNotThrow(() => host.closeFindBar('never-attached'));
  assert.equal(calls.length, 0);
});

test('closeFindBar delegates to the addon', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.closeFindBar('s1');
  assert.ok(calls.includes('closeFindBar:1'));
});

test('clearScrollback on an unattached session is a no-op that does not throw', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  assert.doesNotThrow(() => host.clearScrollback('never-attached'));
  assert.equal(calls.length, 0);
});

test('clearScrollback delegates to the addon', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.clearScrollback('s1');
  assert.ok(calls.includes('clear:1'));
});

const THEME = { background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', ansi: Array(16).fill('#000000') };

test('setTheme on an unattached session is a no-op that does not throw', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  assert.doesNotThrow(() => host.setTheme('never-attached', THEME));
  assert.equal(calls.length, 0);
});

test('setTheme delegates to the addon with the resolved overlay id', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.setTheme('s1', THEME);
  assert.ok(calls.includes('setTheme:1:#1a1b26,#c0caf5,#c0caf5,16'));
});

test('a throwing addon.setTheme does not propagate', () => {
  const { addon, failNext } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  failNext.setTheme = true;
  assert.doesNotThrow(() => host.setTheme('s1', THEME));
});

test('setTheme with no addon is inert', () => {
  const { host } = harness(null);
  assert.doesNotThrow(() => host.setTheme('s1', THEME));
});

test('resyncParent re-pushes the last rect for every overlay on that window', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  host.attach('s1', winA, RECT);
  host.attach('s2', winA, { x: 400, y: 20, width: 300, height: 200 });
  calls.length = 0;

  host.resyncParent(winA);

  assert.deepEqual(calls, ['setFrame:1:10,20,300,200', 'setFrame:2:400,20,300,200']);
});

test('resyncParent uses the latest rect reported via setRect, not the attach rect', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  host.attach('s1', winA, RECT);
  host.setRect('s1', { x: 1, y: 2, width: 3, height: 4 });
  calls.length = 0;

  host.resyncParent(winA);

  assert.deepEqual(calls, ['setFrame:1:1,2,3,4']);
});

test('resyncParent only touches overlays whose parent is that window', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  const winB = Buffer.alloc(8, 2);
  host.attach('s1', winA, RECT);
  host.attach('s2', winB, { x: 400, y: 20, width: 300, height: 200 });
  calls.length = 0;

  host.resyncParent(winB);

  assert.deepEqual(calls, ['setFrame:2:400,20,300,200'], 'must not move the other window’s overlay');
});

test('resyncParent follows an overlay that reparented to another window', () => {
  // The move A->B updates parentBySession; a later frame change on A must not
  // drag the overlay B now owns, and one on B must.
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  const winB = Buffer.alloc(8, 2);
  host.attach('s1', winA, RECT);
  host.attach('s1', winB, RECT);
  calls.length = 0;

  host.resyncParent(winA);
  assert.deepEqual(calls, [], 'the old parent must no longer own this overlay');

  host.resyncParent(winB);
  assert.deepEqual(calls, ['setFrame:1:10,20,300,200']);
});

test('resyncParent skips a detached session — no stale rect is replayed', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  host.attach('s1', winA, RECT);
  host.detach('s1');
  calls.length = 0;

  host.resyncParent(winA);

  assert.deepEqual(calls, []);
});

test('a throwing setFrame during resync does not stop the remaining overlays', () => {
  const { addon, calls, failNext } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  host.attach('s1', winA, RECT);
  host.attach('s2', winA, { x: 400, y: 20, width: 300, height: 200 });
  calls.length = 0;

  failNext.setFrame = true;
  host.resyncParent(winA);

  assert.deepEqual(calls, ['setFrame:1:10,20,300,200', 'setFrame:2:400,20,300,200']);
});

test('resyncParent with no addon is inert', () => {
  const { host } = harness(null);
  assert.doesNotThrow(() => host.resyncParent(Buffer.alloc(8, 1)));
});

test('a native key-window transition is reported for the owning session', () => {
  const { addon, fireFocus } = fakeAddon();
  const { host, focused } = harness(addon);
  host.attach('s1', HANDLE, RECT);

  fireFocus(1, true);
  fireFocus(1, false);

  assert.deepEqual(focused, [['s1', true], ['s1', false]]);
});

test('a focus event for an unknown overlay id is ignored', () => {
  const { addon, fireFocus } = fakeAddon();
  const { host, focused } = harness(addon);
  host.attach('s1', HANDLE, RECT);

  fireFocus(99, true);

  assert.deepEqual(focused, []);
});

test('a detached overlay reports no further focus changes', () => {
  const { addon, fireFocus } = fakeAddon();
  const { host, focused } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.detach('s1');

  fireFocus(1, true);

  assert.deepEqual(focused, []);
});

test('a throwing notifyFocus does not propagate out of the onFocus callback', () => {
  // Same contract as onInput/onResize: this runs off a native dispatch with no
  // JS stack for an exception to unwind into.
  const { addon, fireFocus } = fakeAddon();
  const { host } = harness(addon, {
    notifyFocus: () => { throw new Error('renderer gone'); },
  });
  host.attach('s1', HANDLE, RECT);

  assert.doesNotThrow(() => fireFocus(1, true));
});

test('a link activated in a native overlay is handed to the caller to open', () => {
  const { addon, fireOpenLink } = fakeAddon();
  const { host, opened } = harness(addon);
  host.attach('s1', HANDLE, RECT);

  fireOpenLink(1, 'https://github.com/rbly-internal/api-product/pull/206');

  assert.deepEqual(opened, ['https://github.com/rbly-internal/api-product/pull/206']);
});

test('a link from an unknown overlay id is ignored', () => {
  const { addon, fireOpenLink } = fakeAddon();
  const { host, opened } = harness(addon);
  host.attach('s1', HANDLE, RECT);

  fireOpenLink(99, 'https://example.com');

  assert.deepEqual(opened, []);
});

test('a detached overlay opens no further links', () => {
  const { addon, fireOpenLink } = fakeAddon();
  const { host, opened } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.detach('s1');

  fireOpenLink(1, 'https://example.com');

  assert.deepEqual(opened, []);
});

test('the host does not vet the URL itself — the allowlist is the caller\'s', () => {
  // Deliberate: main.ts owns one allowlist shared with the xterm path, so the
  // host must forward verbatim rather than grow a second, drifting copy.
  const { addon, fireOpenLink } = fakeAddon();
  const { host, opened } = harness(addon);
  host.attach('s1', HANDLE, RECT);

  fireOpenLink(1, 'file:///etc/passwd');

  assert.deepEqual(opened, ['file:///etc/passwd']);
});

test('a throwing openExternal does not propagate out of the onOpenLink callback', () => {
  const { addon, fireOpenLink } = fakeAddon();
  const { host } = harness(addon, {
    openExternal: () => { throw new Error('nope'); },
  });
  host.attach('s1', HANDLE, RECT);

  assert.doesNotThrow(() => fireOpenLink(1, 'https://example.com'));
});
