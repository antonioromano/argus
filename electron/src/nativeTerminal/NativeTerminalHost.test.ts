import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeTerminalHost } from './NativeTerminalHost.js';
import type { HostDeps, NativeTerminalAddon } from './types.js';

function fakeAddon() {
  const calls: string[] = [];
  const createdWith: number[] = [];
  let next = 1;
  let inputCb: ((id: number, d: Buffer) => void) | undefined;
  let resizeCb: ((id: number, c: number, r: number) => void) | undefined;
  let focusCb: ((id: number, focused: boolean) => void) | undefined;
  let openLinkCb: ((id: number, url: string) => void) | undefined;
  let dropCb: ((id: number, paths: string[]) => void) | undefined;
  let bellCb: ((id: number) => void) | undefined;
  let copyCb: ((id: number, text: string) => void) | undefined;
  let scrolledCb: ((id: number, up: boolean) => void) | undefined;
  // Set a flag to true to make the *next* call to that method throw once,
  // then auto-reset — lets a test inject a single fault mid-sequence.
  // What gridSize() reports — the grid the last setFrame produced.
  let grid: { cols: number; rows: number } | undefined = { cols: 100, rows: 30 };
  let gridThrows = false;
  // When set, setFontSize behaves like SwiftTerm's font setter: it changes the
  // grid and reports it through onResize (synchronously here; for real it
  // arrives later through a thread-safe function, which the host must treat
  // the same way).
  let fontGrid: { cols: number; rows: number } | undefined;
  const failNext: Partial<Record<'create' | 'feed' | 'setFrame' | 'setTheme' | 'reparent' | 'openFindBar', boolean>> = {};
  const addon: NativeTerminalAddon = {
    create: (_handle, scrollback) => {
      calls.push(`create:${next}`);
      createdWith.push(scrollback);
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
    setDimmed: (id, dimmed, isDark) => {
      calls.push(`setDimmed:${id}:${dimmed},${isDark}`);
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
    gridSize: (id) => {
      calls.push(`gridSize:${id}`);
      if (gridThrows) throw new Error('gridSize failed');
      return grid;
    },
    clearScrollback: (id) => calls.push(`clear:${id}`),
    focusOverlay: (id) => calls.push(`focusOverlay:${id}`),
    openFindBar: (id) => {
      calls.push(`openFindBar:${id}`);
      if (failNext.openFindBar) { failNext.openFindBar = false; throw new Error('openFindBar failed'); }
    },
    closeFindBar: (id) => calls.push(`closeFindBar:${id}`),
    setFontSize: (id, size) => {
      calls.push(`setFontSize:${id}:${size}`);
      if (fontGrid) {
        grid = fontGrid;
        resizeCb?.(id, fontGrid.cols, fontGrid.rows);
      }
    },
    onInput: (cb) => { inputCb = cb; },
    onResize: (cb) => { resizeCb = cb; },
    onFocus: (cb) => { focusCb = cb; },
    onOpenLink: (cb) => { openLinkCb = cb; },
    onDropPaths: (cb) => { dropCb = cb; },
    onBell: (cb) => { bellCb = cb; },
    onCopy: (cb) => { copyCb = cb; },
    onScrolledUp: (cb) => { scrolledCb = cb; },
  };
  return { addon, calls, createdWith, failNext, setGrid: (g: typeof grid) => { grid = g; },
           setGridThrows: (t: boolean) => { gridThrows = t; },
           setFontGrid: (g: typeof fontGrid) => { fontGrid = g; },
           fireInput: (i: number, s: string) => inputCb!(i, Buffer.from(s)),
           fireResize: (i: number, c: number, r: number) => resizeCb!(i, c, r),
           fireFocus: (i: number, f: boolean) => focusCb!(i, f),
           fireOpenLink: (i: number, u: string) => openLinkCb!(i, u),
           fireDrop: (i: number, p: string[]) => dropCb!(i, p),
           fireBell: (i: number) => bellCb!(i),
           fireCopy: (i: number, t: string) => copyCb!(i, t),
           fireScrolledUp: (i: number, up: boolean) => scrolledCb!(i, up) };
}

function harness(addonOrNull: NativeTerminalAddon | null, overrides: Partial<HostDeps> = {}) {
  const wrote: Array<[string, string]> = [];
  const resized: Array<[string, number, number]> = [];
  const focused: Array<[string, boolean]> = [];
  const opened: string[] = [];
  const dropped: Array<[string, string[]]> = [];
  const bells: string[] = [];
  const copies: Array<[string, string]> = [];
  const order: string[] = [];
  const viewing: Array<[string, boolean]> = [];
  let emit: ((id: string, data: string) => void) | undefined;
  let emitReplay: ((id: string, data: string) => void) | undefined;
  let emitStatus: ((id: string, s: string) => void) | undefined;
  const host = new NativeTerminalHost({
    addon: addonOrNull,
    onOutput: (cb) => { emit = cb; return () => { emit = undefined; }; },
    onReplay: (cb) => { emitReplay = cb; return () => { emitReplay = undefined; }; },
    onStatus: (cb) => { emitStatus = cb; return () => { emitStatus = undefined; }; },
    flushOutput: (id) => order.push(`flush:${id}`),
    setViewing: (id, v) => viewing.push([id, v]),
    writeToSession: (id, d) => wrote.push([id, d]),
    resizeSession: (id, c, r) => { resized.push([id, c, r]); order.push(`resize:${id}:${c}x${r}`); },
    notifyFocus: (id, f) => focused.push([id, f]),
    openExternal: (u) => opened.push(u),
    notifyDropPaths: (id, paths) => dropped.push([id, paths]),
    notifyBell: (id) => bells.push(id),
    notifyCopy: (id, text) => copies.push([id, text]),
    getReplaySnapshot: (id, flavor) => { order.push(`snapshot:${id}:${flavor ?? 'full'}`); return { data: flavor === 'screen' ? 'SCREEN' : 'REPLAY' }; },
    ...overrides,
  });
  return { host, wrote, resized, focused, opened, dropped, bells, copies, order, viewing,
           emitOutput: (id: string, d: string) => emit?.(id, d),
           emitReplay: (id: string, d: string) => emitReplay?.(id, d),
           emitStatus: (id: string, s: string) => emitStatus?.(id, s) };
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

test('overlays are created with the same scrollback depth as xterm tiles', () => {
  const { addon, createdWith } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  assert.deepEqual(createdWith, [5000]);
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

test('a refresh frame is held back while the reader is scrolled up', () => {
  const { addon, calls, fireScrolledUp } = fakeAddon();
  const { host, emitReplay } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  fireScrolledUp(1, true);
  calls.length = 0;
  emitReplay('s1', 'FRAME');
  assert.ok(!calls.some((c) => c.startsWith('feed:')), calls.join(','));
});

test('live output still reaches a scrolled-up reader', () => {
  const { addon, calls, fireScrolledUp } = fakeAddon();
  const { host, emitOutput } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  fireScrolledUp(1, true);
  emitOutput('s1', 'LIVE');
  assert.ok(calls.includes('feed:1:LIVE'));
});

test('returning to the bottom re-seeds exactly once if a refresh was held back', () => {
  const { addon, calls, fireScrolledUp } = fakeAddon();
  const { host, emitReplay, emitOutput } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  fireScrolledUp(1, true);
  emitReplay('s1', 'FRAME1');
  emitReplay('s1', 'FRAME2');
  emitOutput('s1', 'LIVE');
  calls.length = 0;
  fireScrolledUp(1, false);
  assert.equal(calls.filter((c) => c === 'feed:1:REPLAY').length, 1, calls.join(','));
  calls.length = 0;
  fireScrolledUp(1, true);
  fireScrolledUp(1, false);
  assert.ok(!calls.some((c) => c.startsWith('feed:')), 'nothing owed, nothing fed');
});

test('returning to the bottom with nothing held back feeds nothing', () => {
  const { addon, calls, fireScrolledUp } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  fireScrolledUp(1, true);
  calls.length = 0;
  fireScrolledUp(1, false);
  assert.ok(!calls.some((c) => c.startsWith('feed:')));
});

test('a refresh owed on return-to-bottom is not lost if the overlay is hidden at that moment', () => {
  const { addon, calls, fireScrolledUp } = fakeAddon();
  const { host, emitReplay } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  fireScrolledUp(1, true);
  emitReplay('s1', 'FRAME');           // owed while scrolled up
  host.setRect('s1', { x: 0, y: 0, width: 0, height: 0 });   // hole goes off screen — hides the overlay
  calls.length = 0;
  fireScrolledUp(1, false);            // returns to the bottom while still hidden
  assert.ok(!calls.some((c) => c.startsWith('feed:')), calls.join(','));
  host.setRect('s1', RECT);            // hole comes back — reveal seeds
  assert.equal(calls.filter((c) => c === 'feed:1:REPLAY').length, 1, calls.join(','));
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
  const { addon, fireResize, setGrid } = fakeAddon();
  const { host, resized } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  resized.length = 0;   // the attach seed sizes the pty first (tested below)
  setGrid({ cols: 120, rows: 40 });   // the report is for the view's current grid
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
  host.attach('s1', HANDLE, { x: 1, y: 2, width: 90, height: 90 });
  assert.equal(calls.filter((c) => c.startsWith('create:')).length, 1);
  assert.ok(calls.includes('setFrame:1:1,2,90,90'));
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

test('a setFrame failure during attach still leaves a shown, registered overlay', () => {
  // A frame failure must not strand the session invisible: setFrame and show
  // are guarded separately so the overlay is still revealed, and a later
  // setRect can repair its position.
  const { addon, calls, failNext } = fakeAddon();
  const { host } = harness(addon);
  failNext.setFrame = true;
  host.attach('s1', HANDLE, RECT);                 // create succeeds, setFrame throws — must not throw out
  assert.ok(calls.includes('create:1'));
  assert.ok(calls.includes('show:1'), `must still be shown, got ${calls.join(',')}`);
  calls.length = 0;

  host.setRect('s1', { x: 7, y: 8, width: 500, height: 400 });

  assert.deepEqual(calls, ['setFrame:1:7,8,500,400'], 'the overlay is still reachable and repositionable');
});

test('a throwing writeToSession does not propagate out of the onInput callback', () => {
  const { addon, fireInput } = fakeAddon();
  const { host } = harness(addon, { writeToSession: () => { throw new Error('session gone'); } });
  host.attach('s1', HANDLE, RECT);
  assert.doesNotThrow(() => fireInput(1, 'ls\r'));
});

test('a throwing resizeSession does not propagate out of the onResize callback', () => {
  const { addon, fireResize, setGrid } = fakeAddon();
  const { host } = harness(addon, { resizeSession: () => { throw new Error('session gone'); } });
  host.attach('s1', HANDLE, RECT);
  setGrid({ cols: 120, rows: 40 });   // current, so it reaches resizeSession
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
  host.setRect('s1', { x: 1, y: 2, width: 300, height: 400 });
  calls.length = 0;

  host.resyncParent(winA);

  assert.deepEqual(calls, ['setFrame:1:1,2,300,400']);
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

test('setDimmed delegates to the addon with the resolved overlay id', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  calls.length = 0;

  host.setDimmed('s1', true, false);

  assert.deepEqual(calls, ['setDimmed:1:true,false']);
});

test('setDimmed on an unattached session is a no-op that does not throw', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);

  assert.doesNotThrow(() => host.setDimmed('nope', true, true));
  assert.deepEqual(calls, []);
});

test('show re-applies the cached rect before revealing', () => {
  // An overlay hidden for a modal can be revealed into a window that moved
  // while it was out of sight, so the reveal must re-derive its frame.
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.hide('s1');
  calls.length = 0;

  host.show('s1');

  assert.deepEqual(calls, ['setFrame:1:10,20,300,200', 'show:1']);
});

test('show still reveals when there is no cached rect to re-apply', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.detach('s1');
  calls.length = 0;

  // Nothing attached: show must stay inert rather than resurrect anything.
  host.show('s1');

  assert.deepEqual(calls, []);
});




test('a frame at the minimum usable size is applied', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  calls.length = 0;

  host.setRect('s1', { x: 1, y: 2, width: 40, height: 40 });

  assert.deepEqual(calls, ['setFrame:1:1,2,40,40']);
});

test('an overlay whose hole goes off screen is hidden, not left floating', () => {
  // The overlay is its own NSWindow: skipping the update would leave it
  // painting over unrelated UI at its last coordinates (observed with Cmd+E,
  // which maximizes the workbench and hides the tile without unmounting it).
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  calls.length = 0;

  host.setRect('s1', { x: 0, y: 0, width: 0, height: 0 });

  assert.deepEqual(calls, ['hide:1']);
});

test('the overlay comes back when its hole returns, at the rect it returns with', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.setRect('s1', { x: 0, y: 0, width: 0, height: 0 });
  calls.length = 0;

  host.setRect('s1', { x: 5, y: 6, width: 700, height: 500 });

  assert.deepEqual(calls, ['setFrame:1:5,6,700,500', 'show:1']);
});

test('the same rect returning after a hide still re-shows the overlay', () => {
  // The renderer does not update lastRectKey for an off-screen hole precisely
  // so this case reaches us — hiding and returning unchanged is the common
  // shape (open a maximized workbench, close it again).
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.setRect('s1', { x: 0, y: 0, width: 0, height: 0 });
  calls.length = 0;

  host.setRect('s1', RECT);

  assert.deepEqual(calls, ['setFrame:1:10,20,300,200', 'show:1']);
});

test('closing a modal does not reveal an overlay whose tile is off screen', () => {
  // The two conditions are independent: unsuppressing must not override the
  // fact that there is nowhere on screen for this overlay to be.
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.setRect('s1', { x: 0, y: 0, width: 0, height: 0 });   // tile hidden
  host.hide('s1');                                            // modal opens
  calls.length = 0;

  host.show('s1');                                            // modal closes

  assert.deepEqual(calls, [], 'must stay hidden — the hole is still gone');
});

test('a tile becoming visible does not punch through an open modal', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.hide('s1');                                            // modal opens
  calls.length = 0;

  host.setRect('s1', { x: 5, y: 6, width: 700, height: 500 });

  assert.ok(!calls.includes('show:1'), `must stay suppressed, got ${calls.join(',')}`);
});

test('both conditions satisfied reveals exactly once', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.setRect('s1', { x: 0, y: 0, width: 0, height: 0 });
  host.hide('s1');
  calls.length = 0;

  host.setRect('s1', RECT);   // hole back, still suppressed
  host.show('s1');            // modal closes

  assert.deepEqual(calls, ['setFrame:1:10,20,300,200', 'show:1']);
});

test('resyncParent repositions visible overlays but never reveals a hidden one', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.attach('s2', HANDLE, { x: 400, y: 20, width: 300, height: 200 });
  host.setRect('s2', { x: 0, y: 0, width: 0, height: 0 });   // s2's tile hidden
  calls.length = 0;

  host.resyncParent(HANDLE);

  assert.deepEqual(calls, ['setFrame:1:10,20,300,200']);
});

test('attaching with a hole that is not laid out yet does not flash the overlay', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);

  host.attach('s1', HANDLE, { x: 0, y: 0, width: 0, height: 0 });

  assert.ok(!calls.includes('show:1'), `must not show at construction size, got ${calls.join(',')}`);
  assert.ok(calls.includes('create:1'));
});

test('suppression is idempotent — a repeat hide does not stack', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.hide('s1');
  calls.length = 0;

  host.hide('s1');
  host.show('s1');

  assert.deepEqual(calls, ['setFrame:1:10,20,300,200', 'show:1']);
});

test('a re-attach does not resurrect an overlay whose tile is hidden', () => {
  // The tile remounting (or its session moving between windows) measures at
  // mount time, which during a maximized workbench briefly reads as a
  // full-size hole. Trusting that rect showed the overlay on top of the
  // workbench — the Cmd+E / Cmd+D report.
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.setRect('s1', { x: 70, y: 121, width: 1316, height: 0 });   // maximized
  calls.length = 0;

  host.attach('s1', HANDLE, RECT);   // remount, stale full-size measurement

  assert.ok(!calls.includes('show:1'), `must stay hidden, got ${calls.join(',')}`);
});

test('a re-attach does not clear an active suppression', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.hide('s1');                   // modal open
  calls.length = 0;

  host.attach('s1', HANDLE, RECT);

  assert.ok(!calls.includes('show:1'), `must stay suppressed, got ${calls.join(',')}`);
});

test('a first attach still shows the overlay', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);

  host.attach('s1', HANDLE, RECT);

  assert.ok(calls.includes('show:1'));
});

test('focusOverlay delegates to the addon with the resolved overlay id', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  calls.length = 0;

  host.focusOverlay('s1');

  assert.deepEqual(calls, ['focusOverlay:1']);
});

test('focusOverlay on an unattached session is a no-op that does not throw', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);

  assert.doesNotThrow(() => host.focusOverlay('nope'));
  assert.deepEqual(calls, []);
});

test('dropped paths are forwarded for the owning session', () => {
  const { addon, fireDrop } = fakeAddon();
  const { host, dropped } = harness(addon);
  host.attach('s1', HANDLE, RECT);

  fireDrop(1, ['/tmp/a.txt', '/tmp/b b.txt']);

  assert.deepEqual(dropped, [['s1', ['/tmp/a.txt', '/tmp/b b.txt']]]);
});

test('an empty drop is not forwarded', () => {
  const { addon, fireDrop } = fakeAddon();
  const { host, dropped } = harness(addon);
  host.attach('s1', HANDLE, RECT);

  fireDrop(1, []);

  assert.deepEqual(dropped, []);
});

test('a drop on an unknown overlay id is ignored', () => {
  const { addon, fireDrop } = fakeAddon();
  const { host, dropped } = harness(addon);
  host.attach('s1', HANDLE, RECT);

  fireDrop(99, ['/tmp/a.txt']);

  assert.deepEqual(dropped, []);
});

test('a throwing notifyDropPaths does not propagate out of the callback', () => {
  const { addon, fireDrop } = fakeAddon();
  const { host } = harness(addon, {
    notifyDropPaths: () => { throw new Error('renderer gone'); },
  });
  host.attach('s1', HANDLE, RECT);

  assert.doesNotThrow(() => fireDrop(1, ['/tmp/a.txt']));
});

test('a bell is reported for the owning session', () => {
  const { addon, fireBell } = fakeAddon();
  const { host, bells } = harness(addon);
  host.attach('s1', HANDLE, RECT);

  fireBell(1);

  assert.deepEqual(bells, ['s1']);
});

test('a bell on an unknown overlay id is ignored', () => {
  const { addon, fireBell } = fakeAddon();
  const { host, bells } = harness(addon);
  host.attach('s1', HANDLE, RECT);

  fireBell(99);

  assert.deepEqual(bells, []);
});

test('a copy from an overlay is forwarded for its session', () => {
  const { addon, fireCopy } = fakeAddon();
  const { host, copies } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  fireCopy(1, 'raw\ntext');
  assert.deepEqual(copies, [['s1', 'raw\ntext']]);
});

test('a copy from an unknown overlay is ignored, and a throwing notifyCopy does not escape', () => {
  const { addon, fireCopy } = fakeAddon();
  const { host, copies } = harness(addon, { notifyCopy: () => { throw new Error('boom'); } });
  host.attach('s1', HANDLE, RECT);
  assert.doesNotThrow(() => fireCopy(1, 'x'));
  assert.doesNotThrow(() => fireCopy(99, 'x'));
  assert.deepEqual(copies, []);
});

// ── Review fixes: seed timing, replay frames, focus, resize suspension ──

test('the seed sizes the pty to the overlay grid, flushes, then snapshots — in that order', () => {
  const { addon, calls } = fakeAddon();
  const { host, order } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  assert.deepEqual(order, ['resize:s1:100x30', 'flush:s1', 'snapshot:s1:full']);
  // The frame is applied before the seed is fed, so SwiftTerm parses the seed
  // at the width it was serialized for, and the seed lands before show.
  const frame = calls.indexOf('setFrame:1:10,20,300,200');
  const feed = calls.indexOf('feed:1:REPLAY');
  const show = calls.indexOf('show:1');
  assert.ok(frame >= 0 && frame < feed && feed < show, calls.join(','));
});

test('output flushed while seeding is not fed a second time', () => {
  const { addon, calls } = fakeAddon();
  let emit: ((id: string, d: string) => void) | undefined;
  const { host } = harness(addon, {
    onOutput: (cb) => { emit = cb; return () => {}; },
    // The flush delivers pending bytes that the snapshot also contains.
    flushOutput: (id) => emit?.(id, 'PENDING'),
  });
  host.attach('s1', HANDLE, RECT);
  assert.ok(!calls.includes('feed:1:PENDING'), calls.join(','));
  emit?.('s1', 'LIVE');
  assert.ok(calls.includes('feed:1:LIVE'));
});

test('an overlay attached with no usable hole is not seeded until it gets one', () => {
  const { addon, calls } = fakeAddon();
  const { host, emitOutput } = harness(addon);
  host.attach('s1', HANDLE, { x: 0, y: 0, width: 0, height: 0 });
  emitOutput('s1', 'EARLY');
  assert.ok(!calls.some((c) => c.startsWith('feed:')), calls.join(','));
  host.setRect('s1', RECT);
  assert.ok(calls.includes('feed:1:REPLAY'));
});

test('replacement frames reach a seeded overlay', () => {
  const { addon, calls } = fakeAddon();
  const { host, emitReplay } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  emitReplay('s1', 'FRAME');
  assert.ok(calls.includes('feed:1:FRAME'));
});

test('attach and detach report the native viewer to the server', () => {
  const { addon } = fakeAddon();
  const { host, viewing } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.attach('s1', HANDLE, RECT);   // a re-attach is not a second viewer
  host.detach('s1');
  assert.deepEqual(viewing, [['s1', true], ['s1', false]]);
});

test('detaching an overlay that holds key focus reports the focus lost', () => {
  const { addon, fireFocus } = fakeAddon();
  const { host, focused } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  fireFocus(1, true);
  host.detach('s1');
  assert.deepEqual(focused, [['s1', true], ['s1', false]]);
});

test('detaching an unfocused overlay reports nothing', () => {
  const { addon, fireFocus } = fakeAddon();
  const { host, focused } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  fireFocus(1, true);
  fireFocus(1, false);
  host.detach('s1');
  assert.deepEqual(focused, [['s1', true], ['s1', false]]);
});

test('resizes are held while suspended and only the last one is applied on release', () => {
  const { addon, fireResize, setGrid } = fakeAddon();
  const { host, resized } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  resized.length = 0;
  host.setResizeSuspended('s1', true);
  // Each report is current when it arrives, as during a live divider drag.
  setGrid({ cols: 90, rows: 30 });
  fireResize(1, 90, 30);
  setGrid({ cols: 80, rows: 30 });
  fireResize(1, 80, 30);
  assert.deepEqual(resized, []);
  host.setResizeSuspended('s1', false);
  assert.deepEqual(resized, [['s1', 80, 30]]);
});

test('releasing a suspension with no resize in between applies nothing', () => {
  const { addon } = fakeAddon();
  const { host, resized } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  resized.length = 0;
  host.setResizeSuspended('s1', true);
  host.setResizeSuspended('s1', false);
  assert.deepEqual(resized, []);
});

test('attach applies the font size before seeding, so the seed matches the final grid', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT, 15);
  const font = calls.indexOf('setFontSize:1:15');
  const seed = calls.indexOf('gridSize:1');
  assert.ok(font >= 0 && font < seed, calls.join(','));
});

test('setFontSize applies to an attached overlay and ignores nonsense', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  calls.length = 0;
  host.setFontSize('s1', 16);
  host.setFontSize('s1', 0);
  host.setFontSize('s1', Number.NaN);
  // (A real change also re-seeds — covered separately below.)
  assert.deepEqual(calls.filter((c) => c.startsWith('setFontSize:')), ['setFontSize:1:16']);
});

test('zoom scales frames and font from CSS px to points', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT, 10);
  calls.length = 0;
  host.setZoom(HANDLE, 1.5);
  assert.ok(calls.includes('setFontSize:1:15'), calls.join(','));
  assert.ok(calls.includes('setFrame:1:15,30,450,300'), calls.join(','));
});

test('attach after setZoom scales the first frame and font', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.setZoom(HANDLE, 2);
  host.attach('s1', HANDLE, RECT, 10);
  assert.ok(calls.includes('setFontSize:1:20'), calls.join(','));
  assert.ok(calls.includes('setFrame:1:20,40,600,400'), calls.join(','));
});

test('zoom on one window leaves overlays on another alone', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  const winB = Buffer.alloc(8, 2);
  host.attach('s1', winA, RECT, 10);
  calls.length = 0;
  host.setZoom(winB, 2);
  assert.equal(calls.length, 0, calls.join(','));
});

test('a rect from a window that is no longer the parent is ignored', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  const winB = Buffer.alloc(8, 2);
  host.attach('s1', winA, RECT);
  host.attach('s1', winB, RECT);   // moved to window B
  calls.length = 0;
  host.setRect('s1', { x: 0, y: 0, width: 0, height: 0 }, winA);   // A's tile collapsing
  host.closeFindBar('s1', winA);
  assert.equal(calls.length, 0, calls.join(','));
  host.setRect('s1', { x: 0, y: 0, width: 0, height: 0 }, winB);
  assert.ok(calls.includes('hide:1'));
});

// ── Final review: stale resize reports, font re-seed, attach font guard ──

test('a resize report for a grid that is no longer current is not forwarded', () => {
  // SwiftTerm reports asynchronously; by the time a report lands the view may
  // already be at another size (seed() sized the pty to it synchronously).
  const { addon, fireResize } = fakeAddon();
  const { host, resized } = harness(addon);
  host.attach('s1', HANDLE, RECT);                    // grid is 100x30
  resized.length = 0;
  fireResize(1, 120, 40);                             // superseded report
  assert.deepEqual(resized, []);
});

test('a resize report is still forwarded when the grid cannot be read', () => {
  const { addon, fireResize, setGridThrows } = fakeAddon();
  const { host, resized } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  resized.length = 0;
  setGridThrows(true);
  fireResize(1, 120, 40);
  assert.deepEqual(resized, [['s1', 120, 40]]);
});

test('a resize report for a hidden overlay is not forwarded', () => {
  const { addon, fireResize, setGrid } = fakeAddon();
  const { host, resized } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.setRect('s1', { x: 0, y: 0, width: 0, height: 0 });   // tile off screen
  resized.length = 0;
  setGrid({ cols: 120, rows: 40 });
  fireResize(1, 120, 40);
  assert.deepEqual(resized, []);
});

test('a resize report for an unseeded overlay is not forwarded — seed() sizes the pty', () => {
  // The font pushed at attach resizes the construction-size grid and reports
  // it before the first frame; only the seed's own resize may reach the pty.
  const { addon, setFontGrid } = fakeAddon();
  const { host, resized } = harness(addon);
  setFontGrid({ cols: 90, rows: 28 });
  host.attach('s1', HANDLE, RECT, 15);
  assert.deepEqual(resized, [['s1', 90, 28]], 'only the seed resize');
});

test('an unchanged font size makes no native call and does not re-seed', () => {
  const { addon, calls } = fakeAddon();
  const { host, order } = harness(addon);
  host.attach('s1', HANDLE, RECT, 15);
  calls.length = 0;
  order.length = 0;
  host.setFontSize('s1', 15);
  assert.deepEqual(calls, []);
  assert.deepEqual(order, []);
});

test('a font change on a shown overlay re-seeds it after the font is applied', () => {
  // SwiftTerm soft-resets on a font change (cursor visibility, SGR, modes),
  // so the screen has to be rebuilt from the replay frame.
  const { addon, calls } = fakeAddon();
  const { host, order } = harness(addon);
  host.attach('s1', HANDLE, RECT, 15);
  calls.length = 0;
  order.length = 0;
  host.setFontSize('s1', 16);
  assert.deepEqual(calls, ['setFontSize:1:16', 'gridSize:1', 'feed:1:REPLAY']);
  assert.deepEqual(order, ['resize:s1:100x30', 'flush:s1', 'snapshot:s1:full']);
});

test('a font change on a hidden overlay defers the re-seed until it is shown', () => {
  const { addon, calls } = fakeAddon();
  const { host, emitOutput } = harness(addon);
  host.attach('s1', HANDLE, RECT, 15);
  host.setRect('s1', { x: 0, y: 0, width: 0, height: 0 });
  calls.length = 0;
  host.setFontSize('s1', 16);
  emitOutput('s1', 'WHILE-HIDDEN');                  // covered by the reveal seed
  assert.deepEqual(calls, ['setFontSize:1:16']);
  host.setRect('s1', RECT);
  assert.equal(calls.filter((c) => c === 'feed:1:REPLAY').length, 1, calls.join(','));
  assert.ok(!calls.includes('feed:1:WHILE-HIDDEN'), calls.join(','));
});

test('a zoom change on a shown overlay pushes font, then frame, then re-seeds', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT, 10);
  calls.length = 0;
  host.setZoom(HANDLE, 1.5);
  assert.deepEqual(calls, ['setFontSize:1:15', 'setFrame:1:15,30,450,300', 'gridSize:1', 'feed:1:REPLAY']);
});

test('a zoom change leaves a hidden overlay unseeded until it is revealed', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT, 10);
  host.setRect('s1', { x: 0, y: 0, width: 0, height: 0 });
  calls.length = 0;
  host.setZoom(HANDLE, 1.5);
  assert.deepEqual(calls, ['setFontSize:1:15']);
  host.setRect('s1', RECT);
  assert.equal(calls.filter((c) => c === 'feed:1:REPLAY').length, 1, calls.join(','));
});

test('attach ignores a non-finite font size from the renderer', () => {
  for (const bad of [Infinity, Number.NaN]) {
    const { addon, calls } = fakeAddon();
    const { host } = harness(addon);
    host.attach('s1', HANDLE, RECT, bad);
    assert.ok(!calls.some((c) => c.startsWith('setFontSize:')), `${bad}: ${calls.join(',')}`);
  }
});

// ── Realign after a resize settles, and after output settles (B4) ──────────

test('a forwarded native resize is followed by one screen-only realign', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { addon, calls, fireResize, setGrid } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  calls.length = 0;
  setGrid({ cols: 90, rows: 30 });
  fireResize(1, 90, 30);
  setGrid({ cols: 80, rows: 30 });
  fireResize(1, 80, 30);          // debounced: one realign for the burst
  t.mock.timers.tick(119);
  assert.ok(!calls.includes('feed:1:SCREEN'));
  t.mock.timers.tick(1);
  assert.equal(calls.filter((c) => c === 'feed:1:SCREEN').length, 1, calls.join(','));
});

test('output settling (running → waiting/done) realigns after 450 ms', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { addon, calls } = fakeAddon();
  const { host, emitStatus } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  emitStatus('s1', 'running');
  calls.length = 0;
  emitStatus('s1', 'waiting');
  t.mock.timers.tick(450);
  assert.ok(calls.includes('feed:1:SCREEN'), calls.join(','));
});

test('other status transitions do not realign', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { addon, calls } = fakeAddon();
  const { host, emitStatus } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  calls.length = 0;
  emitStatus('s1', 'idle');
  emitStatus('s1', 'waiting');
  t.mock.timers.tick(1000);
  assert.ok(!calls.includes('feed:1:SCREEN'));
});

test('a realign that comes due after the overlay was hidden or detached feeds nothing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { addon, calls, fireResize, setGrid } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.attach('s2', HANDLE, { x: 400, y: 20, width: 300, height: 200 });
  setGrid({ cols: 90, rows: 30 });
  fireResize(1, 90, 30);
  fireResize(2, 90, 30);
  host.setRect('s1', { x: 0, y: 0, width: 0, height: 0 });   // hidden
  host.detach('s2');
  calls.length = 0;
  t.mock.timers.tick(1000);
  assert.ok(!calls.some((c) => c.startsWith('feed:')), calls.join(','));
});
