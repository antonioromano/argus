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
  private readonly parentBySession = new Map<string, string>();
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

  /**
   * Returns whether an overlay is live for this session afterward — true
   * even if a post-create call below (seed/setFrame/show) failed, since the
   * overlay rollback decision keeps it registered in that case. Only a
   * missing addon or a failed create() yields false, telling the caller
   * there is no overlay to show and it should fall back to xterm.js.
   */
  attach(sessionId: string, parentHandle: Buffer, rect: Rect): boolean {
    if (!this.addon) return false;
    let id = this.bySession.get(sessionId);
    if (id === undefined) {
      try {
        id = this.addon.create(parentHandle);
      } catch (err) {
        // create() failed — no window exists, so no map entry must be made.
        console.error('[native-term] create failed for', sessionId, err);
        return false;
      }
      this.bySession.set(sessionId, id);
      this.byOverlay.set(id, sessionId);
      this.parentBySession.set(sessionId, parentHandle.toString('base64'));
      // Seed with the same replay frame a joining socket gets, so the native
      // view opens on the current screen instead of an empty one. Best-effort:
      // once create() has succeeded the overlay is a real native window, and
      // losing track of its id here would leak it (the native side has no
      // double-attach guard to fall back on), so a failure below does not
      // unregister it — it stays reachable via setRect/show/hide/detach.
      try {
        const snap = this.deps.getReplaySnapshot(sessionId);
        if (snap) this.addon.feed(id, Buffer.from(snap.data, 'utf8'));
      } catch (err) {
        console.error('[native-term] replay seed failed for', sessionId, err);
      }
    } else {
      // A session can move between Argus windows; the overlay must follow it.
      const parentKey = parentHandle.toString('base64');
      if (this.parentBySession.get(sessionId) !== parentKey) {
        try {
          this.addon.reparent(id, parentHandle);
          // Only record success: a failed reparent leaves the overlay on its
          // old (real) parent, and the tracked key must reflect that so the
          // next attach() sees the mismatch again and retries, rather than
          // believing the move already happened and stranding the overlay.
          this.parentBySession.set(sessionId, parentKey);
        } catch (err) {
          console.error('[native-term] reparent failed for', sessionId, err);
        }
      }
    }
    try {
      this.addon.setFrame(id, rect.x, rect.y, rect.width, rect.height);
      this.addon.show(id);
    } catch (err) {
      console.error('[native-term] setFrame/show failed for', sessionId, err);
    }
    return true;
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

  /**
   * Opens SwiftTerm's OWN find bar for this overlay (see task-6's reversal:
   * a DOM search box can never paint above a native tile's child NSWindow,
   * so the renderer no longer sends a search term here — it just toggles
   * SwiftTerm's own bar, which lives inside that window and owns its own
   * typing/next/prev/options). No-op for a session with no attached overlay
   * or when the addon call throws, matching every other native call's
   * degrade-rather-than-throw contract.
   */
  openFindBar(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined || !this.addon) return;
    try {
      this.addon.openFindBar(id);
    } catch (err) {
      console.error('[native-term] openFindBar failed for', sessionId, err);
    }
  }

  /** Closes the native find bar and clears its search highlight/selection. */
  closeFindBar(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined || !this.addon) return;
    try {
      this.addon.closeFindBar(id);
    } catch (err) {
      console.error('[native-term] closeFindBar failed for', sessionId, err);
    }
  }

  /**
   * Purges the native view's own scrollback (SwiftTerm's `Terminal.clearScrollback()`),
   * the native counterpart of the xterm.js path's local `terminal.write('\x1b[3J')` —
   * a native overlay has no xterm instance for that instant local feedback, so
   * this is the only thing that ever visually clears its history.
   */
  clearScrollback(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined || !this.addon) return;
    try {
      this.addon.clearScrollback(id);
    } catch (err) {
      console.error('[native-term] clearScrollback failed for', sessionId, err);
    }
  }

  /**
   * True when `parentHandle` is either absent (an unconditional caller — see
   * below) or matches the window `attach()`/`reparent()` last recorded as
   * this session's live parent.
   *
   * A session can move between Argus windows (`attach()`'s reparent branch
   * above). When it does, the window it left still has a tile tearing down
   * on its own timing, and that teardown's effect-cleanup fires the same
   * detach/hide/show a real caller would use. Without this gate that stale
   * call would win a race against the new window's already-succeeded attach
   * and destroy/hide the overlay the new window just acquired — permanently,
   * since the new window's own effect never re-fires to repair it.
   *
   * `parentHandle` is therefore optional and gates only renderer-initiated
   * calls that legitimately have a requesting window to check (the IPC
   * handlers in main.ts for detach/suppress/unsuppress, which resolve it
   * from the sender's BrowserWindow rather than trusting a renderer-supplied
   * id). Callers with no window context — onSessionDeleted (the session is
   * gone; the overlay must die no matter who "owns" it), dispose() on app
   * quit, and a window's own 'closed' handler tearing down what it hosted —
   * omit it and stay unconditional, exactly as before this gate existed.
   */
  private isCurrentParent(sessionId: string, parentHandle?: Buffer): boolean {
    if (!parentHandle) return true;
    return this.parentBySession.get(sessionId) === parentHandle.toString('base64');
  }

  show(sessionId: string, parentHandle?: Buffer): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined) return;
    if (!this.isCurrentParent(sessionId, parentHandle)) return;
    try {
      this.addon?.show(id);
    } catch (err) {
      console.error('[native-term] show failed for', sessionId, err);
    }
  }

  hide(sessionId: string, parentHandle?: Buffer): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined) return;
    if (!this.isCurrentParent(sessionId, parentHandle)) return;
    try {
      this.addon?.hide(id);
    } catch (err) {
      console.error('[native-term] hide failed for', sessionId, err);
    }
  }

  /**
   * Returns whether the detach actually proceeded — false only when a
   * `parentHandle` was supplied and it no longer matches this session's
   * current parent (a stale request, ignored). Callers that track
   * window→session ownership of their own (main.ts's windowIdToSessions)
   * must consult this before dropping that bookkeeping: a session ignored
   * here is still live, natively, under its real parent.
   */
  detach(sessionId: string, parentHandle?: Buffer): boolean {
    const id = this.bySession.get(sessionId);
    if (id === undefined || !this.addon) return true;
    if (!this.isCurrentParent(sessionId, parentHandle)) return false;
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
    this.parentBySession.delete(sessionId);
    return true;
  }

  dispose(): void {
    for (const sessionId of [...this.bySession.keys()]) this.detach(sessionId);
    this.unsubscribe?.();
  }
}
