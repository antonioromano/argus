import type { Terminal } from '@xterm/xterm';

// DECSET/DECRST private modes for mouse tracking + extended encodings.
//
// Argus keeps xterm itself OUT of mouse-reporting mode so plain click-drag does
// native text selection. But the inner app (Claude Code, vim, less) still *wants*
// mouse — it sent the enable; our swallow is display-side only. So we record that
// the app wants mouse and synthesize wheel/click reports to the pty ourselves:
// wheel scrolls the app's history and a no-movement click reaches the app, while
// drags stay local selections.
//
// Deliberately NOT included: 1004 (focus reporting — harmless, used by Claude),
// 1049/47/1047 (alt-screen — needed by vim/less), 2004 (bracketed paste), 25
// (cursor visibility).
const MOUSE_MODES = new Set([1000, 1001, 1002, 1003, 1005, 1006, 1015, 1016]);
const SGR_MODES = new Set([1006, 1015]);

// px of wheel travel per synthesized wheel report
const WHEEL_STEP = 12;
const MAX_REPORTS_PER_WHEEL = 6;
// movement (px) above which a press-release counts as a drag (local selection)
const DRAG_THRESHOLD = 4;

// Touch fling/inertia (alternate screen only — no native scrollback to ride).
// On lift we keep emitting wheel reports with exponential decay so the app coasts.
// Lift speed is measured over a short *trailing* window so a flick's peak velocity
// (not its slow start) drives the coast; a launch multiplier makes a flick "throw".
const INERTIA_FRICTION = 0.965; // per-16.67ms velocity multiplier (~0.9–1.1s coast)
const INERTIA_MIN_VELOCITY = 0.04; // px/ms — below this, stop the coast
const FLING_MIN_VELOCITY = 0.15; // px/ms — below this lift-off speed, no fling
const FLING_LAUNCH_MULTIPLIER = 1.3; // coast starts a bit faster than the finger ("launch")
const FLING_MAX_VELOCITY = 4.0; // px/ms — clamp after the multiplier
const MAX_INERTIA_REPORTS_PER_FRAME = 4; // bound the per-frame socket burst (alt path only)
const VELOCITY_SAMPLE_WINDOW_MS = 60; // trailing window for the lift-speed estimate

// Swallow the sequence only when every param is a mouse mode. Returning false
// (the param set mixes in a non-mouse mode, or is empty) lets xterm's default
// handler run, preserving all other private modes.
function isMouseModeSet(params: (number | number[])[]): boolean {
  if (params.length === 0) return false;
  for (const p of params) {
    const mode = Array.isArray(p) ? p[0] : p;
    if (!MOUSE_MODES.has(mode)) return false;
  }
  return true;
}

function hasSgrMode(params: (number | number[])[]): boolean {
  for (const p of params) {
    const mode = Array.isArray(p) ? p[0] : p;
    if (SGR_MODES.has(mode)) return true;
  }
  return false;
}

function clamp(min: number, n: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

interface MouseState {
  appMouse: boolean;
  sgr: boolean;
}

function loadState(key: string): MouseState {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) return JSON.parse(raw) as MouseState;
  } catch {
    /* sessionStorage unavailable / malformed — fall through to default */
  }
  return { appMouse: false, sgr: true };
}

function saveState(key: string, state: MouseState): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* best-effort persistence across Cmd+R */
  }
}

/**
 * Keep the terminal out of mouse-reporting mode (so plain drag selects text)
 * while still letting the inner app receive wheel + single clicks. Tracks the
 * app's mouse-mode request (persisted across Cmd+R via sessionStorage) and
 * synthesizes mouse reports to the pty via `sendInput`.
 *
 * Parser-level swallowing is chunk-safe — xterm reassembles split escape
 * sequences internally before invoking the handler.
 *
 * @param sendInput omit (readOnly) to disable wheel/click forwarding while still
 *   keeping selection working.
 * @param kind namespaces the persisted mouse state so panes that share a sessionId
 *   (e.g. the Claude terminal and its companion shell) don't inherit each other's
 *   app-mouse intent. Omit for the primary terminal (back-compat key).
 * @returns `{ dispose, reconcileMouse }` — `dispose` removes listeners and the
 *   parser handlers; `reconcileMouse(appMouse, sgr)` overwrites the gate state to
 *   match tmux's truth (called on each authoritative replay).
 */
export function installSelectableMouse(
  terminal: Terminal,
  container: HTMLElement,
  sessionId: string,
  sendInput?: (data: string) => void,
  kind?: string,
): { dispose: () => void; reconcileMouse: (appMouse: boolean, sgr: boolean) => void } {
  const storageKey = kind ? 'argus:mouse:' + kind + ':' + sessionId : 'argus:mouse:' + sessionId;
  const state = loadState(storageKey);

  // Reconcile the wheel-forwarding gate to the server's tmux truth (shipped with
  // each authoritative replay). Overwrites any value persisted across Cmd+R, so a
  // stale `appMouse` can't keep forwarding wheels after the app dropped mouse mode.
  const reconcileMouse = (appMouse: boolean, sgr: boolean) => {
    state.appMouse = appMouse;
    state.sgr = sgr;
    saveState(storageKey, state);
  };

  const onSet = terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
    if (!isMouseModeSet(params)) return false;
    state.appMouse = true;
    if (hasSgrMode(params)) state.sgr = true;
    saveState(storageKey, state);
    return true; // swallow — xterm must not enter mouse mode
  });
  const onReset = terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
    if (!isMouseModeSet(params)) return false;
    state.appMouse = false;
    saveState(storageKey, state);
    return true;
  });

  // Gate xterm's OWN built-in wheel handler. With mouse mode swallowed (so plain
  // drag still selects text), xterm's always-on wheel listener takes its
  // alt-buffer path on EVERY alt-screen wheel: it converts the wheel into
  // arrow-key sequences, sends them to the pty, and `cancel`s the event with
  // stopPropagation (browser/Terminal.ts) — both walking a mouse app's input
  // history AND killing our `onWheel` below (xterm's listener is a child element
  // and fires first). Suppress it (return false) ONLY for a mouse-holding app on
  // the alternate screen (Claude): then no arrows fire, nothing is cancelled, and
  // the event bubbles to `onWheel`, which forwards a real wheel report so Claude
  // scrolls itself. Otherwise return true and let xterm do the right native thing
  // — alt-scroll arrow keys for a no-mouse pager, scrollback on the normal screen.
  terminal.attachCustomWheelEventHandler(
    () => !(terminal.buffer.active.type === 'alternate' && state.appMouse),
  );

  // ---- wheel → scroll the inner app ----
  let wheelAcc = 0;
  const onWheel = (e: WheelEvent) => {
    // Forward the wheel as a mouse report only when a mouse-holding app is on the
    // alternate screen (Claude): tmux delivers it to the app (`send -M`) and the
    // app scrolls its own view. The custom wheel handler above suppresses xterm's
    // arrow-key path for exactly this case so this listener gets to run. Every
    // other case is left to xterm (no-mouse pager → arrow keys; normal screen →
    // seeded scrollback).
    if (!state.appMouse || !sendInput || terminal.buffer.active.type !== 'alternate') return;

    // Never while the button is down. A wheel here reaches the app, which
    // repaints the alternate screen under a selection anchored to those same
    // cells: the highlight stays put while different text slides beneath it, so
    // the drag ends up selecting a range the user never saw. Suppressing it
    // costs nothing — scrolling mid-drag could not extend the selection anyway,
    // since the alternate screen has no scrollback to extend into.
    if (tracking) { e.preventDefault(); return; }

    e.preventDefault();
    wheelAcc += e.deltaY;
    let reports = Math.trunc(wheelAcc / WHEEL_STEP);
    if (reports === 0) return;
    wheelAcc -= reports * WHEEL_STEP;
    const down = reports > 0;
    reports = clamp(1, Math.abs(reports), MAX_REPORTS_PER_WHEEL);
    const seq = wheelSeq(state.sgr, down);
    for (let i = 0; i < reports; i++) sendInput(seq);
  };

  // ---- press-release without movement → click into the inner app ----
  let downX = 0;
  let downY = 0;
  let tracking = false;
  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    downX = e.clientX;
    downY = e.clientY;
    tracking = true;
  };
  const onMouseUp = (e: MouseEvent) => {
    if (!tracking) return;
    tracking = false;
    if (!state.appMouse || !sendInput || e.button !== 0) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) >= DRAG_THRESHOLD) return; // a drag → local selection
    const screenEl = container.querySelector<HTMLElement>('.xterm-screen') ?? container;
    const rect = screenEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const col = clamp(1, Math.floor((e.clientX - rect.left) / (rect.width / terminal.cols)) + 1, terminal.cols);
    const row = clamp(1, Math.floor((e.clientY - rect.top) / (rect.height / terminal.rows)) + 1, terminal.rows);
    sendInput(clickSeq(state.sgr, col, row));
  };

  // ---- touch (mobile): drag → scroll, tap → click ----
  // Two scroll surfaces:
  //  • Normal buffer (Claude, shell prompt) — the conversation lives in xterm's own
  //    scrollback. We drive `terminal.scrollLines` locally (no network) and KILL the
  //    native iOS momentum (e.preventDefault), because xterm re-snaps scrollTop to whole
  //    rows on every render (Viewport _innerRefresh) and that fights native pixel momentum
  //    into the stutter/halt the user saw.
  //  • Alternate screen (vim/less) — no native scrollback, so a drag is forwarded to the
  //    pty as synthesized wheel reports, exactly as before.
  // A no-movement tap clicks into the app (when it requested mouse).
  let touchY = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartT = 0;
  let touchAcc = 0; // fractional px → wheel notches (alt path)
  let touchMoved = false;
  let touchTracking = false;
  // Fling/inertia state. `velocitySamples` is a rolling buffer of recent finger positions;
  // on lift we derive a trailing-window velocity and coast via requestAnimationFrame.
  let inertiaRaf = 0;
  let velocitySamples: { t: number; y: number }[] = [];

  // Normal-buffer DRAG is handled NATIVELY by xterm itself: it binds its own touch
  // listeners on `.xterm` (gated on !areMouseEventsActive, which is always false here
  // because Argus swallows the mouse-mode enable). Its handleTouchMove does
  // `viewport.scrollTop += delta` — a cheap scrollTop write whose row re-render is
  // debounced into a requestAnimationFrame, OFF the touch path. That is why it never
  // triggers iOS touchcancel. We must NOT also scroll it (double-scroll + the heavy
  // synchronous `scrollLines` re-render were the jumpy/stuck cause). So on the normal
  // buffer we stay out of the way entirely during the drag.
  //
  // The only things we still own:
  //  • Alt screen (vim/less): xterm's native scroll moves an empty alt buffer (nothing),
  //    so we forward wheel reports to the pty.
  //  • Tap-to-click: xterm won't (we swallowed mouse mode), so we synthesize the click.
  //  • Fling: xterm has no inertia. After lift we coast by writing viewport.scrollTop
  //    ourselves — also off the touch path (finger is up), so no touchcancel. Reading
  //    scrollTop fresh each frame absorbs xterm's per-render row-snap.
  let viewportEl: HTMLElement | null = null;
  const getViewport = () => {
    if (!viewportEl) viewportEl = container.querySelector<HTMLElement>('.xterm-viewport');
    return viewportEl;
  };

  // ---- dev trace pipeline (?debug=1): stream per-gesture events to the server ----
  const TRACE = typeof window !== 'undefined' && window.location.search.includes('debug=1');
  const traceT0 = performance.now();
  let traceBuf: string[] = [];
  const rec = (s: string) => { if (TRACE) traceBuf.push(`${(performance.now() - traceT0).toFixed(0)} ${s}`); };
  const flushTrace = () => {
    if (!TRACE || traceBuf.length === 0) return;
    const fit = (window as Window & { __argusFit?: number }).__argusFit ?? 0;
    const body = `fit=${fit} buf=${terminal.buffer.active.type}\n${traceBuf.join('\n')}`;
    traceBuf = [];
    fetch('/api/debug/scroll', { method: 'POST', body, keepalive: true }).catch(() => {});
  };
  // xterm's own scroll (and its row-snap _refresh) shows up as scroll events on the viewport.
  const onVpScroll = () => {
    if (!TRACE) return;
    const vp = getViewport();
    rec(`SC sTop=${vp ? Math.round(vp.scrollTop) : -1} vpY=${terminal.buffer.active.viewportY}`);
  };
  // Row-quantized scroll. We are the SOLE scroll authority (xterm's own touch handler is
  // suppressed via a capture-phase stopPropagation — see listener registration). Scrolling
  // ONLY in whole rows means the scrollTop xterm derives (ydisp*rowHeight) already sits on a
  // row boundary, so xterm's per-render snap is a no-op — that snap-back was the visible jump.
  let rowAcc = 0;           // fractional px carried between moves
  let rowHeight = 17;       // measured per gesture from the visible screen
  // DRAG path: defer scrollLines to a rAF (off the touch event) so the row re-render never
  // happens synchronously inside touchmove — that synchronous re-render was the touchcancel.
  let pendingRows = 0;
  let flushRaf = 0;
  const flushRows = () => {
    flushRaf = 0;
    if (pendingRows !== 0) { terminal.scrollLines(pendingRows); pendingRows = 0; }
  };
  const scrollRowsDeferred = (travel: number) => {
    rowAcc += travel;
    const rows = Math.trunc(rowAcc / rowHeight);
    if (rows === 0) return;
    rowAcc -= rows * rowHeight;
    pendingRows += rows;
    if (!flushRaf) flushRaf = requestAnimationFrame(flushRows);
  };
  // COAST path (already in rAF, no finger down): scroll synchronously and report edge so the
  // fling can stop at top/bottom. Whole rows, same as drag.
  const coastRows = (travel: number): boolean => {
    rowAcc += travel;
    const rows = Math.trunc(rowAcc / rowHeight);
    if (rows === 0) return true;
    rowAcc -= rows * rowHeight;
    const before = terminal.buffer.active.viewportY;
    terminal.scrollLines(rows);
    return terminal.buffer.active.viewportY !== before;
  };

  const cancelInertia = () => {
    if (inertiaRaf) {
      cancelAnimationFrame(inertiaRaf);
      inertiaRaf = 0;
    }
  };

  // True when the inner app owns the screen (vim/less) — drag is forwarded as wheel.
  const isAltScroll = () =>
    state.appMouse && !!sendInput && terminal.buffer.active.type === 'alternate';

  // Convert px of (virtual) finger travel into wheel reports for the inner app. `touchAcc`
  // carries fractional px so slow travel still accumulates to a notch.
  const emitWheelReports = (travel: number, cap: number) => {
    if (!sendInput) return;
    touchAcc += travel;
    let reports = Math.trunc(touchAcc / WHEEL_STEP);
    if (reports === 0) return;
    touchAcc -= reports * WHEEL_STEP;
    const down = reports > 0;
    reports = clamp(1, Math.abs(reports), cap);
    const seq = wheelSeq(state.sgr, down);
    for (let i = 0; i < reports; i++) sendInput(seq);
  };

  // Coast after a flick. `scrollFn(px)` advances the active surface and returns false at an
  // edge (so the coast can stop). Runs entirely in requestAnimationFrame — no touch active —
  // so writing scrollTop / emitting wheel reports here never trips iOS touchcancel. Decay
  // uses the measured frame delta so it stays correct if a frame runs long.
  const startCoast = (v0: number, scrollFn: (px: number) => boolean) => {
    let velocity = v0;
    let lastT = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = now - lastT;
      lastT = now;
      if (!scrollFn(velocity * dt)) { inertiaRaf = 0; return; } // hit an edge
      velocity *= Math.pow(INERTIA_FRICTION, dt / 16.67);
      if (Math.abs(velocity) < INERTIA_MIN_VELOCITY) { inertiaRaf = 0; return; }
      inertiaRaf = requestAnimationFrame(step);
    };
    inertiaRaf = requestAnimationFrame(step);
  };

  // Coast scroll functions, one per surface. Alt forwards wheel reports (always "moves");
  // normal scrolls whole rows and reports edge.
  const coastAlt = (px: number): boolean => { emitWheelReports(px, MAX_INERTIA_REPORTS_PER_FRAME); return true; };
  const coastNormal = (px: number): boolean => coastRows(px);

  const sampleVelocity = (now: number, y: number) => {
    velocitySamples.push({ t: now, y });
    while (velocitySamples.length > 2 && now - velocitySamples[0].t > VELOCITY_SAMPLE_WINDOW_MS) {
      velocitySamples.shift();
    }
  };

  // Lift velocity (px/ms; finger up → positive → scroll toward newer) over a trailing window so a
  // flick's peak speed drives the coast. `liftY` is the actual lift point when known (touchend).
  const computeLiftVelocity = (now: number, liftY: number | null): number => {
    if (liftY != null) sampleVelocity(now, liftY);
    const newest = velocitySamples[velocitySamples.length - 1];
    let ref = velocitySamples[0];
    for (let i = velocitySamples.length - 2; i >= 0; i--) {
      ref = velocitySamples[i];
      if (newest.t - velocitySamples[i].t >= VELOCITY_SAMPLE_WINDOW_MS) break;
    }
    if (newest && ref && newest !== ref && newest.t - ref.t > 0) return (ref.y - newest.y) / (newest.t - ref.t);
    if (liftY != null) { const dt = now - touchStartT; if (dt > 0) return (touchStartY - liftY) / dt; }
    return 0;
  };
  const launchFling = (velocity: number): boolean => {
    if (Math.abs(velocity) < FLING_MIN_VELOCITY) return false;
    const v = clamp(-FLING_MAX_VELOCITY, velocity * FLING_LAUNCH_MULTIPLIER, FLING_MAX_VELOCITY);
    startCoast(v, isAltScroll() ? coastAlt : coastNormal);
    return true;
  };

  // Watchdog: a quick flick is exactly one touchmove then lift, but that lone scrollLines re-render
  // detaches the touched row div, so iOS dispatches touchend to a node no longer in the document —
  // it reaches neither container nor window, and the gesture never flings (feels stuck). If no
  // touchend arrives shortly after the last move AND the lift speed is a real flick, finalize here.
  // Low-velocity (slow/paused drag) → no-op, so genuine drags are never cut short.
  let watchdog = 0;
  const clearWatchdog = () => { if (watchdog) { clearTimeout(watchdog); watchdog = 0; } };
  const armWatchdog = () => {
    clearWatchdog();
    watchdog = window.setTimeout(() => {
      watchdog = 0;
      if (!touchTracking || !touchMoved) return;
      const v = computeLiftVelocity(performance.now(), null);
      if (Math.abs(v) < FLING_MIN_VELOCITY) return; // not a flick — leave the drag tracking
      touchTracking = false;
      if (flushRaf) { cancelAnimationFrame(flushRaf); flushRaf = 0; }
      flushRows();
      rec(`WD v=${v.toFixed(3)} — recovered lost touchend`);
      flushTrace();
      launchFling(v);
    }, 90);
  };

  type DbgRef = Window & { __argusScrollDebug?: string };

  const onTouchStart = (e: TouchEvent) => {
    cancelInertia(); // a new touch kills any running coast
    clearWatchdog();
    if (flushRaf) { cancelAnimationFrame(flushRaf); flushRaf = 0; }
    pendingRows = 0;
    e.stopPropagation(); // suppress xterm's own touch handler — we are the sole scroll authority
    if (e.touches.length !== 1) { touchTracking = false; return; }
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    touchStartT = performance.now();
    touchY = t.clientY;
    touchAcc = 0;
    rowAcc = 0;
    touchMoved = false;
    touchTracking = true;
    velocitySamples = [{ t: touchStartT, y: t.clientY }];
    // Measure row height from the visible screen (height / visible rows).
    const screenEl = container.querySelector<HTMLElement>('.xterm-screen');
    const screenH = screenEl ? screenEl.getBoundingClientRect().height : 0;
    rowHeight = screenH > 0 && terminal.rows > 0 ? screenH / terminal.rows : 17;
    if (!(rowHeight > 0)) rowHeight = 17;
    rec(`TS y=${Math.round(t.clientY)} vpY=${terminal.buffer.active.viewportY} rowH=${rowHeight.toFixed(1)}`);
  };
  const onTouchMove = (e: TouchEvent) => {
    e.stopPropagation(); // keep xterm's handler from also scrolling
    if (!touchTracking || e.touches.length !== 1) return;
    const t = e.touches[0];
    // We own the gesture: preventDefault every move so no native pan engages.
    e.preventDefault();
    if (Math.hypot(t.clientX - touchStartX, t.clientY - touchStartY) >= DRAG_THRESHOLD) touchMoved = true;
    if (!touchMoved) { touchY = t.clientY; return; }
    sampleVelocity(performance.now(), t.clientY);
    const travel = touchY - t.clientY; // finger up → positive → scroll toward newer
    if (isAltScroll()) {
      emitWheelReports(travel, MAX_REPORTS_PER_WHEEL); // vim/less: forward to pty
    } else {
      scrollRowsDeferred(travel); // normal: whole-row scroll, deferred to rAF (no touchcancel)
    }
    touchY = t.clientY;
    armWatchdog(); // recover the fling if touchend is lost to a detached target
    rec(`TM dY=${Math.round(travel)} rowAcc=${rowAcc.toFixed(0)} pend=${pendingRows} vpY=${terminal.buffer.active.viewportY}`);
    (window as DbgRef).__argusScrollDebug = `DRAG alt:${isAltScroll()} vpY:${terminal.buffer.active.viewportY}`;
  };
  const onTouchEnd = (e: TouchEvent) => {
    // Listens on `window` (capture): scrollLines re-renders the row divs, detaching the node
    // the touch started on, so iOS may dispatch touchend to a detached target that never bubbles
    // through `container`. A window-level listener catches it regardless. Guarded by touchTracking,
    // so unrelated touches are ignored. No stopPropagation (xterm binds no touchend handler).
    if (!touchTracking) return;
    touchTracking = false;
    clearWatchdog();
    if (flushRaf) { cancelAnimationFrame(flushRaf); flushRaf = 0; }
    flushRows(); // commit any pending drag rows before the fling reads viewportY
    rec(`TE moved=${touchMoved}`);
    // Tap (no movement) → click into the app (only when it requested mouse).
    if (!touchMoved) {
      flushTrace();
      (window as DbgRef).__argusScrollDebug = `TAP (no drag) appMouse:${state.appMouse}`;
      if (!state.appMouse || !sendInput) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const screenEl = container.querySelector<HTMLElement>('.xterm-screen') ?? container;
      const rect = screenEl.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const col = clamp(1, Math.floor((t.clientX - rect.left) / (rect.width / terminal.cols)) + 1, terminal.cols);
      const row = clamp(1, Math.floor((t.clientY - rect.top) / (rect.height / terminal.rows)) + 1, terminal.rows);
      sendInput(clickSeq(state.sgr, col, row));
      return;
    }
    // Drag → fling with inertia (both scroll surfaces).
    const lift = e.changedTouches[0];
    const velocity = computeLiftVelocity(performance.now(), lift ? lift.clientY : null);
    const flingEngages = Math.abs(velocity) >= FLING_MIN_VELOCITY;
    rec(`FLING v=${velocity.toFixed(3)} engages=${flingEngages}`);
    flushTrace();
    (window as DbgRef).__argusScrollDebug =
      `LIFT v:${velocity.toFixed(2)} fling:${flingEngages ? 'Y' : `N(<${FLING_MIN_VELOCITY})`}`;
    launchFling(velocity);
  };

  const onTouchCancel = () => {
    if (!touchTracking) return;
    touchTracking = false;
    clearWatchdog();
    if (flushRaf) { cancelAnimationFrame(flushRaf); flushRaf = 0; }
    flushRows();
    rec('TC — iOS cancelled gesture');
    flushTrace();
    (window as DbgRef).__argusScrollDebug = 'CANCEL';
  };

  container.addEventListener('wheel', onWheel, { passive: false });
  container.addEventListener('mousedown', onMouseDown);
  container.addEventListener('mouseup', onMouseUp);
  // CAPTURE phase: fires on the way DOWN to the target, before xterm's own bubble-phase touch
  // listeners on the inner `.xterm` element. Each handler calls e.stopPropagation() so xterm
  // never sees the touch — that makes us the sole scroll authority and kills the double-scroll
  // (xterm scrollTop += px) that was fighting our row-quantized scrolling.
  container.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  container.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  // end/cancel on WINDOW (capture): the touched row div gets detached by scrollLines re-render,
  // so iOS may target touchend at a node outside `container` — window catches it either way.
  window.addEventListener('touchend', onTouchEnd, { capture: true });
  window.addEventListener('touchcancel', onTouchCancel, { capture: true });
  if (TRACE) getViewport()?.addEventListener('scroll', onVpScroll, { passive: true });

  const dispose = () => {
    cancelInertia(); // a fling started just before unmount must not emit after teardown
    clearWatchdog();
    if (flushRaf) { cancelAnimationFrame(flushRaf); flushRaf = 0; }
    onSet.dispose();
    onReset.dispose();
    container.removeEventListener('wheel', onWheel);
    container.removeEventListener('mousedown', onMouseDown);
    container.removeEventListener('mouseup', onMouseUp);
    container.removeEventListener('touchstart', onTouchStart, { capture: true });
    container.removeEventListener('touchmove', onTouchMove, { capture: true });
    window.removeEventListener('touchend', onTouchEnd, { capture: true });
    window.removeEventListener('touchcancel', onTouchCancel, { capture: true });
    if (TRACE) getViewport()?.removeEventListener('scroll', onVpScroll);
  };

  return { dispose, reconcileMouse };
}

function wheelSeq(sgr: boolean, down: boolean): string {
  // wheel buttons: up = 64, down = 65
  const btn = down ? 65 : 64;
  if (sgr) return `\x1b[<${btn};1;1M`;
  // legacy X10/normal encoding, coords (1,1)
  return '\x1b[M' + String.fromCharCode(32 + btn, 33, 33);
}

function clickSeq(sgr: boolean, col: number, row: number): string {
  // left button = 0
  if (sgr) return `\x1b[<0;${col};${row}M\x1b[<0;${col};${row}m`;
  // legacy: press button 0, then release (button 3)
  const press = '\x1b[M' + String.fromCharCode(32, 32 + col, 32 + row);
  const release = '\x1b[M' + String.fromCharCode(32 + 3, 32 + col, 32 + row);
  return press + release;
}
