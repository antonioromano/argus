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
 */
const rects = new Map<string, Rect>();
const holders = new Map<string, number>();   // sessionId -> suppression refcount

// Every currently-active `suppress('all')` handle, keyed by the same `ids`
// array the caller holds. A bare counter can't tell registerOverlay which
// sessionIds belong to which still-live full-screen suppression, so a
// session registered after suppress('all') was called (empty snapshot) would
// never be added to any handle's ids and would stay hidden forever after
// release(). Tracking the live handles lets registerOverlay push the new id
// into every active handle's (mutable) ids array and hold() once per handle,
// so the refcount matches the number of suppressors currently covering it.
interface AllHandle { ids: string[] }
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
  // must join every active full-screen suppression's own ids, not just be
  // hidden once, so each suppressor's eventual release() correctly accounts
  // for it (see the AllHandle comment above).
  for (const h of activeAllHandles) {
    h.ids.push(sessionId);
    hold(sessionId);
  }
}

export function unregisterOverlay(sessionId: string): void {
  rects.delete(sessionId);
  holders.delete(sessionId);
}

export interface SuppressionHandle { ids: string[]; release(): void }

/** Hide every overlay this surface covers. The returned handle is the ONLY way
 *  to undo it — a single token rather than paired suppress/release functions,
 *  so a caller cannot release a full-screen suppression with the wrong one and
 *  silently leave terminals invisible forever. */
export function suppress(target: 'all' | Rect): SuppressionHandle {
  const isAll = target === 'all';
  const ids: string[] = isAll
    ? [...rects.keys()]
    : [...rects.entries()].filter(([, r]) => intersects(r, target)).map(([id]) => id);
  for (const id of ids) hold(id);

  // `ids` doubles as the handle's own mutable membership list: registerOverlay
  // appends to it directly (see above) so a late-arriving overlay is tracked
  // by exactly the suppressions that were active when it registered.
  const allHandle: AllHandle | undefined = isAll ? { ids } : undefined;
  if (allHandle) activeAllHandles.add(allHandle);

  let released = false;
  return {
    ids,
    release() {
      if (released) return;        // double-release must not decrement twice
      released = true;
      if (allHandle) activeAllHandles.delete(allHandle);
      for (const id of ids) {
        const n = holders.get(id);
        if (n === undefined) continue;          // unregistered while suppressed
        if (n <= 1) { holders.delete(id); if (rects.has(id)) transport.show(id); }
        else holders.set(id, n - 1);
      }
    },
  };
}
