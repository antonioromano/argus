export interface Rect { x: number; y: number; width: number; height: number }

interface Transport { hide(sessionId: string): void; show(sessionId: string): void }

/**
 * A child NSWindow always paints above its parent's web content (measured in
 * Gate A: child order[0], parent order[1], same layer). So any DOM surface
 * that overlaps a live overlay's rect — a tooltip, a modal, a menu — would
 * render underneath it unless the overlay is hidden for the duration.
 * Blanket-hiding every terminal for a tooltip is unacceptable, so suppression
 * is intersection-based: only overlays the surface actually covers are hidden,
 * with a refcount so overlapping suppressions compose correctly.
 *
 * Module-level singleton state: this is per-renderer. Each Electron
 * BrowserWindow runs its own renderer process with its own JS module
 * instance, so this registry is deliberately NOT shared across windows —
 * every window suppresses and shows only the native overlays it hosts.
 */
const rects = new Map<string, Rect>();
const holders = new Map<string, number>();   // sessionId -> suppression refcount

// Every currently-active `suppress('all')` handle, keyed by the same `ids`
// Set the caller's handle reads from. A bare counter can't tell
// registerOverlay which sessionIds belong to which still-live full-screen
// suppression, so a session registered after suppress('all') was called
// (empty snapshot) would never be tracked by any handle and would stay
// hidden forever after release(). Tracking the live handles lets
// registerOverlay add the new id into every active handle's membership and
// hold() once per handle, so the refcount matches the number of suppressors
// currently covering it.
//
// Membership is a Set, not an array: registerOverlay can run repeatedly for
// the same id while a suppression is active (useNativeOverlayRect reports
// on every geometry change, not just on attach), and unregisterOverlay can
// be followed by a re-register while the same suppression is still active
// (a tile unmounting and a new one taking its sessionId, or a rect update
// racing a detach). An array would accumulate duplicate entries — one push
// per report/re-register — so a single handle's release() would walk more
// entries than it ever put a hold on, decrementing (and potentially zeroing)
// a refcount that another, still-active handle also holds. A Set makes
// "already tracked by this handle" a single O(1) check, so each handle
// holds a given id at most once no matter how many times it re-registers.
interface AllHandle { ids: Set<string> }
const activeAllHandles = new Set<AllHandle>();

// Every active suppressLive() handle. A partial-rect suppress() snapshots the
// overlays it covers once, which is wrong for a surface that must stay on top
// while the layout under it changes (the deep-link approval card: a tile can
// reflow or register under it, and the window can resize and move the
// right-anchored stack). A live handle re-evaluates its membership whenever an
// overlay registers or reports new geometry (synchronously, so nothing ever
// paints over it) and on window resize / refresh() (rAF-throttled), diffing
// the set it holds instead of releasing and re-suppressing.
interface LiveHandle { getRect: () => Rect | null; ids: Set<string> }
const liveHandles = new Set<LiveHandle>();
let liveFrame: { cancel(): void } | null = null;

function scheduleLiveReevaluation(): void {
  if (liveFrame) return;
  const run = () => { liveFrame = null; for (const h of liveHandles) evaluateLive(h); };
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(run);
    liveFrame = { cancel: () => cancelAnimationFrame(id) };
  } else {
    const id = setTimeout(run, 16);
    liveFrame = { cancel: () => clearTimeout(id) };
  }
}
const onWindowResize = () => scheduleLiveReevaluation();

// Tiles swap in a placeholder while a full-screen surface is up, so every tile
// looks the same whether its terminal is a hidden native view or a web one.
const fullScreenListeners = new Set<() => void>();
function notifyFullScreen(): void { for (const fn of fullScreenListeners) fn(); }

/** True while at least one suppress('all') surface (sheet, modal) is open. */
export function isFullScreenSuppressed(): boolean { return activeAllHandles.size > 0; }

export function subscribeFullScreenSuppression(fn: () => void): () => void {
  fullScreenListeners.add(fn);
  return () => { fullScreenListeners.delete(fn); };
}

let transport: Transport = { hide: () => {}, show: () => {} };

export function setSuppressionTransport(t: Transport): void { transport = t; }

export function resetOverlayRegistryForTests(): void {
  rects.clear(); holders.clear(); activeAllHandles.clear();
  liveHandles.clear(); liveFrame?.cancel(); liveFrame = null;
  if (typeof window !== 'undefined') window.removeEventListener('resize', onWindowResize);
  notifyFullScreen();
  transport = { hide: () => {}, show: () => {} };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
      && a.y < b.y + b.height && b.y < a.y + a.height;
}

function hold(sessionId: string): void {
  const n = (holders.get(sessionId) ?? 0) + 1;
  holders.set(sessionId, n);
  if (n === 1) transport.hide(sessionId);
}

/** Drop one hold; the last holder re-shows the overlay if it still exists. */
function unhold(sessionId: string): void {
  const n = holders.get(sessionId);
  if (n === undefined) return;                  // unregistered while suppressed
  if (n <= 1) { holders.delete(sessionId); if (rects.has(sessionId)) transport.show(sessionId); }
  else holders.set(sessionId, n - 1);
}

/** Bring one live handle's hold on one overlay in line with the current geometry. */
function syncLive(h: LiveHandle, sessionId: string, surface: Rect | null): void {
  const r = rects.get(sessionId);
  const covered = !!surface && !!r && intersects(r, surface);
  if (covered && !h.ids.has(sessionId)) { h.ids.add(sessionId); hold(sessionId); }
  else if (!covered && h.ids.has(sessionId)) { h.ids.delete(sessionId); unhold(sessionId); }
}

function evaluateLive(h: LiveHandle): void {
  const surface = h.getRect();
  for (const id of new Set([...rects.keys(), ...h.ids])) syncLive(h, id, surface);
}

export function registerOverlay(sessionId: string, rect: Rect): void {
  rects.set(sessionId, rect);
  // A tile that appears while a sheet is open must not flash over it. It
  // must join every active full-screen suppression's own membership, not
  // just be hidden once, so each suppressor's eventual release() correctly
  // accounts for it (see the AllHandle comment above). Repeated calls for an
  // id a handle already tracks (e.g. a geometry report while suppressed) are
  // no-ops here — the id is already held exactly once by that handle.
  for (const h of activeAllHandles) {
    if (h.ids.has(sessionId)) continue;
    h.ids.add(sessionId);
    hold(sessionId);
  }
  // Live partial suppressions: a tile that registers or moves under the
  // surface is hidden now; one that moves out is shown again.
  for (const h of liveHandles) syncLive(h, sessionId, h.getRect());
}

export function unregisterOverlay(sessionId: string): void {
  rects.delete(sessionId);
  holders.delete(sessionId);
  // Drop it from every active handle too — otherwise a later re-register of
  // the same sessionId while the suppression is still active would add a
  // second, stale membership that a single release() would over-decrement.
  for (const h of activeAllHandles) h.ids.delete(sessionId);
  for (const h of liveHandles) h.ids.delete(sessionId);
}

export interface SuppressionHandle { ids: string[]; release(): void }

/** Hide every overlay this surface covers. The returned handle is the ONLY way
 *  to undo it — a single token rather than paired suppress/release functions,
 *  so a caller cannot release a full-screen suppression with the wrong one and
 *  silently leave terminals invisible forever. */
export function suppress(target: 'all' | Rect): SuppressionHandle {
  const isAll = target === 'all';
  const idSet: Set<string> = isAll
    ? new Set(rects.keys())
    : new Set([...rects.entries()].filter(([, r]) => intersects(r, target)).map(([id]) => id));
  for (const id of idSet) hold(id);

  // For a full-screen suppression, idSet doubles as the handle's own live
  // membership: registerOverlay/unregisterOverlay (see above) mutate it
  // directly so a later release() knows about overlays that joined or left
  // after suppress() was called. For a partial-rect suppression it is a
  // fixed snapshot — only 'all' suppressions track latecomers.
  const allHandle: AllHandle | undefined = isAll ? { ids: idSet } : undefined;
  if (allHandle) { activeAllHandles.add(allHandle); notifyFullScreen(); }

  let released = false;
  return {
    // A getter, not a plain field: it derives from the live Set on every
    // read rather than freezing an array at creation time, so `.ids` stays
    // accurate even if read after registerOverlay/unregisterOverlay has
    // changed membership (existing callers only read it right after
    // suppress() returns, but nothing here should rely on that).
    get ids() { return [...idSet]; },
    release() {
      if (released) return;        // double-release must not decrement twice
      released = true;
      if (allHandle) { activeAllHandles.delete(allHandle); notifyFullScreen(); }
      for (const id of idSet) {
        const n = holders.get(id);
        if (n === undefined) continue;          // unregistered while suppressed
        if (n <= 1) { holders.delete(id); if (rects.has(id)) transport.show(id); }
        else holders.set(id, n - 1);
      }
    },
  };
}

export interface LiveSuppressionHandle {
  readonly ids: string[];
  /** Re-evaluate on the next frame (e.g. the surface itself resized). */
  refresh(): void;
  release(): void;
}

/**
 * Like suppress(rect), but kept true for the handle's lifetime: overlays that
 * register, move under, or move out from under `getRect()` are hidden/shown as
 * it happens, and window resizes re-measure the surface. `getRect` returning
 * null means the surface covers nothing right now.
 */
export function suppressLive(getRect: () => Rect | null): LiveSuppressionHandle {
  const h: LiveHandle = { getRect, ids: new Set() };
  if (liveHandles.size === 0 && typeof window !== 'undefined') window.addEventListener('resize', onWindowResize);
  liveHandles.add(h);
  evaluateLive(h);
  let released = false;
  return {
    get ids() { return [...h.ids]; },
    refresh() { if (!released) scheduleLiveReevaluation(); },
    release() {
      if (released) return;
      released = true;
      liveHandles.delete(h);
      if (liveHandles.size === 0) {
        liveFrame?.cancel(); liveFrame = null;
        if (typeof window !== 'undefined') window.removeEventListener('resize', onWindowResize);
      }
      for (const id of h.ids) unhold(id);
      h.ids.clear();
    },
  };
}
