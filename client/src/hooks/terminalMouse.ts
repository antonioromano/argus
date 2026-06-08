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
const DEFAULT_ROW_HEIGHT = 17; // px fallback if the viewport can't be measured
const DEBUG_SCROLL = typeof window !== 'undefined' && window.location.search.includes('scroll-debug');

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
 * @returns cleanup that removes listeners and disposes the parser handlers.
 */
export function installSelectableMouse(
  terminal: Terminal,
  container: HTMLElement,
  sessionId: string,
  sendInput?: (data: string) => void,
  kind?: string,
): () => void {
  const storageKey = kind ? 'argus:mouse:' + kind + ':' + sessionId : 'argus:mouse:' + sessionId;
  const state = loadState(storageKey);

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

  // ---- wheel → scroll the inner app ----
  let wheelAcc = 0;
  const onWheel = (e: WheelEvent) => {
    // Forward wheel only on the alternate screen (vim/less). On the normal screen
    // (Claude streaming, shell prompt) let xterm scroll its own buffer — otherwise
    // wheel drives the app's internal mouse-scroll UI instead of native scrollback.
    if (!state.appMouse || !sendInput || terminal.buffer.active.type !== 'alternate') return;
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
  let rowAcc = 0; // fractional px → whole rows (normal path)
  let rowHeight = DEFAULT_ROW_HEIGHT;
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
  // Scroll the normal buffer by px (positive → toward newer/bottom). False at an edge.
  const normalScrollBy = (px: number): boolean => {
    const vp = getViewport();
    if (!vp) return false;
    const before = vp.scrollTop;
    vp.scrollTop = before + px;
    return vp.scrollTop !== before;
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
  // normal writes viewport.scrollTop and reports edge via normalScrollBy.
  const coastAlt = (px: number): boolean => { emitWheelReports(px, MAX_INERTIA_REPORTS_PER_FRAME); return true; };
  const coastNormal = (px: number): boolean => normalScrollBy(px);

  const sampleVelocity = (now: number, y: number) => {
    velocitySamples.push({ t: now, y });
    while (velocitySamples.length > 2 && now - velocitySamples[0].t > VELOCITY_SAMPLE_WINDOW_MS) {
      velocitySamples.shift();
    }
  };

  type DbgRef = Window & { __argusScrollDebug?: string };
  let gestureRows = 0; // rows scrolled this gesture (for debug overlay)

  const onTouchStart = (e: TouchEvent) => {
    cancelInertia(); // a new touch kills any running coast
    // Flush any pending deferred scroll from a previous gesture.
    flushPendingScroll();
    lockViewport();
    gestureRows = 0;
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
    // Cell height for 1:1 finger→row mapping. Measure from the VISIBLE screen
    // (height / visible rows), not scrollHeight/buffer.length — the latter races
    // with xterm's relayout and intermittently balloons, stalling a whole drag at
    // one row. Same pattern the tap-to-click mapping uses below.
    const screenEl = container.querySelector<HTMLElement>('.xterm-screen');
    const screenH = screenEl ? screenEl.getBoundingClientRect().height : 0;
    rowHeight = screenH > 0 && terminal.rows > 0 ? screenH / terminal.rows : DEFAULT_ROW_HEIGHT;
    if (!(rowHeight > 0)) rowHeight = DEFAULT_ROW_HEIGHT;
    (window as DbgRef).__argusScrollDebug = `DRAG start rH:${rowHeight.toFixed(1)}`;
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!touchTracking || e.touches.length !== 1) return;
    const t = e.touches[0];
    // We own every single-finger gesture: preventDefault immediately (before the drag
    // threshold) so no native pan can engage and fight xterm's row-snap. Pinch/multitouch
    // returned above, so this never blocks zoom.
    e.preventDefault();
    if (Math.hypot(t.clientX - touchStartX, t.clientY - touchStartY) >= DRAG_THRESHOLD) touchMoved = true;
    if (!touchMoved) { touchY = t.clientY; return; }
    sampleVelocity(performance.now(), t.clientY);
    const prevVp = terminal.buffer.active.viewportY;
    applyTravel(touchY - t.clientY, MAX_REPORTS_PER_WHEEL, true); // deferred — no DOM mutation in handler
    gestureRows += Math.abs(terminal.buffer.active.viewportY - prevVp);
    touchY = t.clientY;
    (window as DbgRef).__argusScrollDebug =
      `DRAG moved:Y acc:${rowAcc.toFixed(1)} rows:${gestureRows} vp:${terminal.buffer.active.viewportY}`;
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (!touchTracking) return;
    touchTracking = false;
    // Tap (no movement) → click into the app (only when it requested mouse).
    if (!touchMoved) {
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
    const now = performance.now();
    const lift = e.changedTouches[0];
    // Record the actual lift point — the last touchmove can be stale on a fast flick.
    if (lift) sampleVelocity(now, lift.clientY);

    const newest = velocitySamples[velocitySamples.length - 1];
    // Trailing window: walk back from newest until we cross VELOCITY_SAMPLE_WINDOW_MS,
    // so the flick's peak speed (not its slow start) drives the coast.
    let ref = velocitySamples[0];
    for (let i = velocitySamples.length - 2; i >= 0; i--) {
      ref = velocitySamples[i];
      if (newest.t - velocitySamples[i].t >= VELOCITY_SAMPLE_WINDOW_MS) break;
    }

    let velocity = 0; // px/ms, drag up → positive → scroll down
    if (newest && ref && newest !== ref && newest.t - ref.t > 0) {
      velocity = (ref.y - newest.y) / (newest.t - ref.t);
    } else if (lift) {
      // Single usable sample (very fast flick): fall back to start→lift.
      const dt = now - touchStartT;
      if (dt > 0) velocity = (touchStartY - lift.clientY) / dt;
    }

    if (DEBUG_SCROLL) {
      console.log('[scroll] type=%s rawV=%s samples=%s rowH=%s',
        terminal.buffer.active.type, velocity.toFixed(3), velocitySamples.length, rowHeight.toFixed(1));
    }
    unlockViewport();
    // Flush any deferred scroll before starting coast so viewportY is up-to-date.
    flushPendingScroll();

    const flingEngages = Math.abs(velocity) >= FLING_MIN_VELOCITY;
    (window as DbgRef).__argusScrollDebug =
      `LIFT dragRows:${gestureRows} v:${velocity.toFixed(2)} fling:${flingEngages ? 'Y' : `N(<${FLING_MIN_VELOCITY})`}`;
    if (!flingEngages) return;
    velocity = clamp(-FLING_MAX_VELOCITY, velocity * FLING_LAUNCH_MULTIPLIER, FLING_MAX_VELOCITY);
    // Do NOT reset touchAcc/rowAcc — fractional px flows into the coast (no seam).
    startCoast(velocity);
  };

  const onTouchCancel = () => {
    if (!touchTracking) return;
    touchTracking = false;
    unlockViewport();
    flushPendingScroll();
    (window as DbgRef).__argusScrollDebug =
      `CANCEL dragRows:${gestureRows} acc:${rowAcc.toFixed(1)} — iOS took gesture`;
  };

  container.addEventListener('wheel', onWheel, { passive: false });
  container.addEventListener('mousedown', onMouseDown);
  container.addEventListener('mouseup', onMouseUp);
  container.addEventListener('touchstart', onTouchStart, { passive: true });
  container.addEventListener('touchmove', onTouchMove, { passive: false });
  container.addEventListener('touchend', onTouchEnd);
  container.addEventListener('touchcancel', onTouchCancel);

  return () => {
    cancelInertia(); // a fling started just before unmount must not emit after teardown
    onSet.dispose();
    onReset.dispose();
    container.removeEventListener('wheel', onWheel);
    container.removeEventListener('mousedown', onMouseDown);
    container.removeEventListener('mouseup', onMouseUp);
    container.removeEventListener('touchstart', onTouchStart);
    container.removeEventListener('touchmove', onTouchMove);
    container.removeEventListener('touchend', onTouchEnd);
    container.removeEventListener('touchcancel', onTouchCancel);
  };
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
