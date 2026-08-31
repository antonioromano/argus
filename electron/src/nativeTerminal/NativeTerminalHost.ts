import type { HostDeps, NativeTerminalAddon, Rect } from './types.js';

/**
 * Owns every native terminal overlay. The native view is a CLIENT of
 * SessionManager: it is fed the same coalesced stream a socket room receives,
 * and its input/resize go back through the ordinary session entry points. It
 * never touches a pty.
 *
 * All policy lives here rather than in Swift so it can be tested without a
 * native build — the addon is injected.
 *
 * Every call across the JS/native boundary is guarded so a failure degrades
 * instead of throwing. Native -> JS callbacks (onInput/onResize/onOutput)
 * are invoked off a native dispatch (a Napi::ThreadSafeFunction), which has
 * no ordinary JS stack for an escaping exception to unwind into. JS -> native
 * calls (create/feed/setFrame/show/hide/destroy) can fail on the addon side
 * (e.g. the ObjC layer returning without a usable window), and an unguarded
 * failure partway through attach() could leave bySession/byOverlay out of
 * sync with each other.
 */
export class NativeTerminalHost {
  private readonly addon: NativeTerminalAddon | null;
  private readonly deps: HostDeps;
  private readonly bySession = new Map<string, number>();
  private readonly byOverlay = new Map<number, string>();
  private unsubscribe?: () => void;

  constructor(deps: HostDeps) {
    this.deps = deps;
    this.addon = deps.addon;
    if (!this.addon) return;

    this.unsubscribe = deps.onOutput((sessionId, data) => {
      const id = this.bySession.get(sessionId);
      if (id === undefined) return;               // not shown natively — ignore
      try {
        this.addon!.feed(id, Buffer.from(data, 'utf8'));
      } catch (err) {
        // A failing feed here must not take down SessionManager's flush loop.
        console.error('[native-term] feed failed for', sessionId, err);
      }
    });

    this.addon.onInput((id, data) => {
      try {
        const sessionId = this.byOverlay.get(id);
        if (sessionId) this.deps.writeToSession(sessionId, data.toString('utf8'));
      } catch (err) {
        // writeToSession throws on an unknown/exited session; that must not
        // escape into the native dispatch that invoked this callback.
        console.error('[native-term] writeToSession failed for overlay', id, err);
      }
    });

    // Native is the resize authority whenever an overlay exists (spec §2).
    this.addon.onResize((id, cols, rows) => {
      try {
        const sessionId = this.byOverlay.get(id);
        if (sessionId) this.deps.resizeSession(sessionId, cols, rows);
      } catch (err) {
        console.error('[native-term] resizeSession failed for overlay', id, err);
      }
    });
  }

  isAvailable(): boolean {
    return this.addon !== null;
  }

  attach(sessionId: string, parentHandle: Buffer, rect: Rect): void {
    if (!this.addon) return;
    let id = this.bySession.get(sessionId);
    if (id === undefined) {
      try {
        id = this.addon.create(parentHandle);
      } catch (err) {
        // create() failed — no window exists, so no map entry must be made.
        console.error('[native-term] create failed for', sessionId, err);
        return;
      }
      this.bySession.set(sessionId, id);
      this.byOverlay.set(id, sessionId);
      // Seed with the same replay frame a joining socket gets, so the native
      // view opens on the current screen instead of an empty one. Best-effort:
      // once create() has succeeded the overlay is a real native window, and
      // losing track of its id here would leak it (the native side has no
      // double-attach guard to fall back on), so a failure below does not
      // unregister it — it stays reachable via setRect/show/hide/detach.
      try {
        const snap = this.deps.getReplaySnapshot(sessionId);
        if (snap) {
          // Enter the alternate buffer BEFORE the seed when the session is in
          // one, so the frame lands where the agent actually drew it.
          const prefix = snap.alternate ? '\x1b[?1049h' : '';
          this.addon.feed(id, Buffer.from(prefix + snap.data, 'utf8'));
        }
      } catch (err) {
        console.error('[native-term] replay seed failed for', sessionId, err);
      }
    }
    try {
      this.addon.setFrame(id, rect.x, rect.y, rect.width, rect.height);
      this.addon.show(id);
    } catch (err) {
      console.error('[native-term] setFrame/show failed for', sessionId, err);
    }
  }

  setRect(sessionId: string, rect: Rect): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined || !this.addon) return;
    try {
      this.addon.setFrame(id, rect.x, rect.y, rect.width, rect.height);
    } catch (err) {
      console.error('[native-term] setFrame failed for', sessionId, err);
    }
  }

  show(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined) return;
    try {
      this.addon?.show(id);
    } catch (err) {
      console.error('[native-term] show failed for', sessionId, err);
    }
  }

  hide(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined) return;
    try {
      this.addon?.hide(id);
    } catch (err) {
      console.error('[native-term] hide failed for', sessionId, err);
    }
  }

  detach(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined || !this.addon) return;
    try {
      this.addon.destroy(id);
    } catch (err) {
      console.error('[native-term] destroy failed for', sessionId, err);
    }
    // Drop our bookkeeping regardless — a caller that asked to detach must
    // not keep feeding/resizing this session natively even if native-side
    // teardown itself failed.
    this.bySession.delete(sessionId);
    this.byOverlay.delete(id);
  }

  dispose(): void {
    for (const sessionId of [...this.bySession.keys()]) this.detach(sessionId);
    this.unsubscribe?.();
  }
}
