import type { HostDeps, NativeTerminalAddon, Rect, Theme } from './types.js';

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
/**
 * Smallest frame worth applying to an overlay, in points.
 *
 * A degenerate rect is not harmless. Swift clamps width/height to >= 1, so a
 * 0-wide hole becomes a 1pt view, SwiftTerm computes ~2 columns from it, and —
 * because native is the resize authority — that 2-column geometry is pushed
 * all the way to the pty. The agent then reflows its ENTIRE transcript to two
 * characters per line, and since that text is already in the scrollback,
 * resizing back does not undo it.
 *
 * The renderer legitimately measures such rects: a tile mid-mount, or one
 * whose container is display:none, reports 0x0 through getBoundingClientRect.
 * At a typical cell of ~7x15pt, 40x40 cannot produce a usable terminal under
 * any font size, so anything smaller is a transient layout state rather than a
 * size a user asked for — drop it and keep the last good frame.
 */
const MIN_FRAME_PT = 40;

function isUsableFrame(rect: Rect): boolean {
  return rect.width >= MIN_FRAME_PT && rect.height >= MIN_FRAME_PT;
}

/**
 * Temporary geometry tracing, on with ARGUS_NATIVE_TERM_DEBUG=1. Every
 * "misplaced overlay" report so far has been diagnosed by reading the code and
 * been wrong at least once, because the interesting question — what the
 * renderer actually measured, and what the host decided in response — is
 * invisible from the outside. Logs only decisions, not every frame.
 */
const DEBUG = process.env.ARGUS_NATIVE_TERM_DEBUG === '1';
function trace(...args: unknown[]): void {
  if (DEBUG) console.log('[native-term:trace]', ...args);
}

export class NativeTerminalHost {
  private readonly addon: NativeTerminalAddon | null;
  private readonly deps: HostDeps;
  private readonly bySession = new Map<string, number>();
  private readonly byOverlay = new Map<number, string>();
  private readonly parentBySession = new Map<string, string>();
  // Last viewport rect reported for each session, kept so resyncParent() can
  // re-derive the overlay's screen frame after the parent window moves.
  private readonly rectBySession = new Map<string, Rect>();
  // An overlay is on screen only when BOTH hold: its hole is actually laid out
  // and visible in the renderer, and nothing (a modal, a palette) is
  // suppressing it. They are tracked separately because they are set by
  // unrelated events and neither may clobber the other — a modal closing must
  // not reveal an overlay whose tile is hidden behind a maximized workbench,
  // and a tile becoming visible must not punch through an open modal.
  private readonly holeVisible = new Map<string, boolean>();
  private readonly suppressed = new Set<string>();
  // What we have actually told the native side, so applyVisibility only emits
  // a call on a real transition. Both inputs change independently and often
  // land in the same state twice in a row (a modal closing over a tile that
  // is still hidden), and an overlay must not be re-hidden or re-shown for
  // that.
  private readonly shown = new Set<string>();
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

    this.addon.onFocus((id, focused) => {
      try {
        const sessionId = this.byOverlay.get(id);
        if (sessionId) this.deps.notifyFocus(sessionId, focused);
      } catch (err) {
        console.error('[native-term] notifyFocus failed for overlay', id, err);
      }
    });

    // The overlay id is looked up only to prove the link came from a live
    // overlay; the URL itself is untrusted terminal output, so the allowlist
    // that vets it lives in the caller (main.ts), shared with the xterm path.
    this.addon.onOpenLink((id, url) => {
      try {
        if (!this.byOverlay.has(id)) return;
        this.deps.openExternal(url);
      } catch (err) {
        console.error('[native-term] openExternal failed for overlay', id, err);
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
    const isNew = id === undefined;
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
    // A degenerate attach rect must not reach the view (see MIN_FRAME_PT).
    // The overlay is still created and shown — it keeps the size it was
    // constructed with until the renderer reports a real rect.
    const usable = isUsableFrame(rect);
    if (usable) this.rectBySession.set(sessionId, rect);
    // Only a FIRST attach may decide visibility from its own rect. A
    // re-attach — the tile remounting, or its session moving between windows —
    // measures at mount time, which during a maximized workbench briefly reads
    // as a full-size hole; trusting it resurrected the overlay on top of the
    // workbench. The renderer re-reports immediately either way, so leaving
    // the existing state alone loses nothing and cannot flash.
    if (isNew) {
      this.holeVisible.set(sessionId, usable);
      this.suppressed.delete(sessionId);
    }
    // Attaching with an unusable hole (a tile mid-mount) must not flash the
    // overlay at its construction size — it stays hidden until a real rect
    // arrives via setRect. applyVisibility owns the frame and the show, and
    // guards its own native calls, so a failure in either leaves the overlay
    // registered and recoverable rather than half-applied.
    const wasShown = this.shown.has(sessionId);
    trace('attach', sessionId.slice(0, 8), rect, 'usable=', usable);
    this.applyVisibility(sessionId, 'attach');
    // A re-attach of an already-visible overlay is a reposition (the same
    // session re-reporting, or moving between windows). applyVisibility saw no
    // transition and so set no frame — do it here.
    if (usable && wasShown && this.shown.has(sessionId)) {
      try {
        this.addon.setFrame(id, rect.x, rect.y, rect.width, rect.height);
      } catch (err) {
        console.error('[native-term] setFrame failed for', sessionId, err);
      }
    }
    return true;
  }

  /**
   * Paints (or clears) the unfocused-tile scrim. The xterm path draws this as
   * a DOM element inside its own container; a native tile cannot, because a
   * child NSWindow paints above the web contents, so the scrim has to live in
   * the overlay's own window. Same values either way — see
   * OverlayController.setDimmed.
   */
  setDimmed(sessionId: string, dimmed: boolean, isDark: boolean): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined || !this.addon) return;
    try {
      this.addon.setDimmed(id, dimmed, isDark);
    } catch (err) {
      console.error('[native-term] setDimmed failed for', sessionId, err);
    }
  }

  setRect(sessionId: string, rect: Rect): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined || !this.addon) return;
    // An unusable rect is not just a frame to skip — it means the hole is not
    // on screen at all (a tile behind a maximized workbench, a collapsed pane,
    // a tile mid-mount). The overlay is its own NSWindow, so leaving it shown
    // would float it over unrelated UI at its last known coordinates. Hide it
    // and keep the last good rect for when the hole comes back.
    if (!isUsableFrame(rect)) {
      trace('setRect UNUSABLE', sessionId.slice(0, 8), rect, '-> hole hidden');
      this.setHoleVisible(sessionId, false, 'setRect(unusable)');
      return;
    }
    trace('setRect', sessionId.slice(0, 8), rect);
    this.rectBySession.set(sessionId, rect);
    if (this.holeVisible.get(sessionId) !== true) {
      // A visibility transition: applyVisibility sets the frame on the way in,
      // so setting it here too would just emit a redundant native call.
      this.setHoleVisible(sessionId, true, 'setRect(usable)');
      return;
    }
    // Already visible — but a suppressed overlay is off screen, so only update
    // the cache and let applyVisibility position it when it is revealed.
    if (this.suppressed.has(sessionId)) return;
    try {
      this.addon.setFrame(id, rect.x, rect.y, rect.width, rect.height);
    } catch (err) {
      console.error('[native-term] setFrame failed for', sessionId, err);
    }
  }

  /**
   * Reports whether this session's hole is currently laid out and on screen.
   * Called by the renderer whenever that changes — the DOM is the only thing
   * that knows, and the overlay is a separate window that will happily keep
   * painting over the rest of the app if nobody tells it.
   */
  setHoleVisible(sessionId: string, visible: boolean, reason = 'setHoleVisible'): void {
    if (this.holeVisible.get(sessionId) === visible) return;
    this.holeVisible.set(sessionId, visible);
    this.applyVisibility(sessionId, reason);
  }

  /**
   * Single writer for an overlay's on-screen state. Every path that could
   * change it (attach, setRect, suppress/unsuppress) funnels here rather than
   * calling addon.show/hide directly, so the two independent conditions can
   * never disagree about the result.
   */
  private applyVisibility(sessionId: string, reason = '?'): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined || !this.addon) return;
    const shouldShow = (this.holeVisible.get(sessionId) ?? false) && !this.suppressed.has(sessionId);
    trace('visibility', sessionId.slice(0, 8), 'via', reason,
      'hole=', this.holeVisible.get(sessionId) ?? false,
      'suppressed=', this.suppressed.has(sessionId),
      'shown=', this.shown.has(sessionId),
      '-> want', shouldShow);
    if (shouldShow === this.shown.has(sessionId)) return;
    if (!shouldShow) {
      this.shown.delete(sessionId);
      try {
        this.addon.hide(id);
      } catch (err) {
        console.error('[native-term] hide failed for', sessionId, err);
      }
      return;
    }
    // Re-derive the frame on the way in: the parent window can move while an
    // overlay is hidden, and setFrame converts against its live frame. Its own
    // try — a frame failure must not stop the overlay being shown, or the
    // session would be stuck invisible with no way back.
    const rect = this.rectBySession.get(sessionId);
    if (rect) {
      try {
        this.addon.setFrame(id, rect.x, rect.y, rect.width, rect.height);
      } catch (err) {
        console.error('[native-term] setFrame failed for', sessionId, err);
      }
    }
    this.shown.add(sessionId);
    try {
      this.addon.show(id);
    } catch (err) {
      console.error('[native-term] show failed for', sessionId, err);
    }
  }

  /**
   * Applies Argus's terminal theme to this overlay — background, foreground,
   * cursor, and (when SwiftTerm accepts a full palette) the 16 ANSI colors.
   * The renderer calls this both right after a successful attach and on
   * every light/dark toggle (see TerminalShellNativeHole), so this is a
   * plain apply-now action, not lifecycle state the host needs to remember:
   * a no-op here for a session with no attached overlay is correct (the
   * renderer's post-attach call is what actually paints the theme once the
   * overlay exists), not a dropped update.
   */
  setTheme(sessionId: string, theme: Theme): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined || !this.addon) return;
    try {
      this.addon.setTheme(id, theme.background, theme.foreground, theme.cursor, theme.ansi);
    } catch (err) {
      console.error('[native-term] setTheme failed for', sessionId, err);
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

  /**
   * Re-applies every overlay's frame for one parent window. Call this
   * whenever that window's own frame changes on screen.
   *
   * The renderer reports the hole in VIEWPORT coordinates, and Swift converts
   * them against the parent's live content rect — so the overlay's screen
   * frame is a function of two inputs, and the renderer only ever notices
   * changes to one of them. Move an Argus window (a window manager like
   * Spectacle, a drag, a display change) and the viewport rects are all
   * still identical, so no ResizeObserver fires and no setRect arrives,
   * while the conversion those old rects were computed against has changed
   * underneath them.
   *
   * AppKit's own child-window follow does not cover this: `addChildWindow`
   * preserves the child's offset from the parent's frame ORIGIN (bottom-left
   * in AppKit), whereas the hole is anchored to the top-left of the content
   * area. The two agree only while the parent's height is unchanged, so any
   * resize — and any move that lands with a resize — leaves the overlay off
   * by the height delta until something re-pushes the frame.
   *
   * Re-pushing the cached rect makes the position a pure function of both
   * inputs again, re-evaluated whenever either moves. Cheap and idempotent:
   * the conversion runs against the parent's current frame, so it is
   * self-correcting no matter how many transient frames a resize animation
   * emits.
   */
  resyncParent(parentHandle: Buffer): void {
    if (!this.addon) return;
    const parentKey = parentHandle.toString('base64');
    trace('resyncParent', parentKey.slice(0, 12), 'sessions=',
      [...this.parentBySession.entries()].filter(([, k]) => k === parentKey).map(([s]) => s.slice(0, 8)));
    for (const [sessionId, key] of this.parentBySession) {
      if (key !== parentKey) continue;
      const id = this.bySession.get(sessionId);
      const rect = this.rectBySession.get(sessionId);
      if (id === undefined || !rect) continue;
      // Reposition only. A hidden overlay stays hidden — applyVisibility will
      // re-derive its frame when it is legitimately revealed.
      if (!(this.holeVisible.get(sessionId) ?? false) || this.suppressed.has(sessionId)) continue;
      try {
        this.addon.setFrame(id, rect.x, rect.y, rect.width, rect.height);
      } catch (err) {
        console.error('[native-term] resync setFrame failed for', sessionId, err);
      }
    }
  }

  /**
   * Releases a suppression (a modal/palette closed). NOT an unconditional
   * reveal: if the hole itself is off screen, the overlay stays hidden.
   */
  show(sessionId: string, parentHandle?: Buffer): void {
    if (this.bySession.get(sessionId) === undefined) return;
    if (!this.isCurrentParent(sessionId, parentHandle)) return;
    if (!this.suppressed.delete(sessionId)) return;
    this.applyVisibility(sessionId, 'unsuppress');
  }

  /** Suppresses this overlay (a modal/palette opened). */
  hide(sessionId: string, parentHandle?: Buffer): void {
    if (this.bySession.get(sessionId) === undefined) return;
    if (!this.isCurrentParent(sessionId, parentHandle)) return;
    if (this.suppressed.has(sessionId)) return;
    this.suppressed.add(sessionId);
    this.applyVisibility(sessionId, 'suppress');
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
    this.rectBySession.delete(sessionId);
    this.holeVisible.delete(sessionId);
    this.suppressed.delete(sessionId);
    this.shown.delete(sessionId);
    return true;
  }

  dispose(): void {
    for (const sessionId of [...this.bySession.keys()]) this.detach(sessionId);
    this.unsubscribe?.();
  }
}
