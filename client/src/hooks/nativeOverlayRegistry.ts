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

let transport: Transport = { hide: () => {}, show: () => {} };

export function setSuppressionTransport(t: Transport): void { transport = t; }

export function resetOverlayRegistryForTests(): void {
  rects.clear(); holders.clear(); activeAllHandles.clear();
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
}

export function unregisterOverlay(sessionId: string): void {
  rects.delete(sessionId);
  holders.delete(sessionId);
  // Drop it from every active handle too — otherwise a later re-register of
  // the same sessionId while the suppression is still active would add a
  // second, stale membership that a single release() would over-decrement.
  for (const h of activeAllHandles) h.ids.delete(sessionId);
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
  if (allHandle) activeAllHandles.add(allHandle);

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
      if (allHandle) activeAllHandles.delete(allHandle);
      for (const id of idSet) {
        const n = holders.get(id);
        if (n === undefined) continue;          // unregistered while suppressed
        if (n <= 1) { holders.delete(id); if (rects.has(id)) transport.show(id); }
        else holders.set(id, n - 1);
      }
    },
  };
}
