import { useEffect, useRef } from 'react';
import { registerOverlay, unregisterOverlay } from './nativeOverlayRegistry.js';

interface NativeOverlayRect { x: number; y: number; width: number; height: number }

interface NativeTerminalBridge {
  available: () => Promise<boolean>;
  attach: (sessionId: string, rect: NativeOverlayRect) => Promise<boolean>;
  setRect: (sessionId: string, rect: NativeOverlayRect) => void;
  detach: (sessionId: string) => void;
}

/**
 * Reports the rect of the transparent "hole" a native terminal overlay must
 * cover. The renderer owns geometry truth; main only mirrors it onto the child
 * NSWindow. Attaches on mount, reports on every geometry change, and detaches
 * on unmount so the overlay can never outlive its tile.
 *
 * Completely inert when `enabled` is false — no IPC, no observers, no
 * listeners — so the xterm.js path (Phase 1 default) is untouched.
 *
 * `attach` is decided globally, once, from an availability check — but
 * `create()` can still fail for one particular session (e.g. the native
 * window budget is exhausted). When main reports that failure, `onFailure`
 * is called so the caller can degrade that one session to xterm.js instead
 * of leaving a permanently blank hole.
 *
 * `onAttached`, when supplied, fires once a real overlay exists (right after
 * a successful `attach()` — the same branch that calls `registerOverlay`).
 * Callers use it to apply state that only makes sense once there's a native
 * window to apply it to (e.g. TerminalShellNativeHole re-running its theme
 * effect) without having to duplicate this hook's own attach bookkeeping.
 */
export function useNativeOverlayRect(
  sessionId: string,
  enabled: boolean,
  onFailure?: () => void,
  onAttached?: () => void,
) {
  const ref = useRef<HTMLDivElement>(null);
  const lastRectKey = useRef<string>('');

  // Mirror the latest onFailure into a ref rather than depending on it
  // directly in the effect below. Callers (TerminalShellNativeHole) build
  // `() => setFailed(true)` inline, so a fresh identity arrives on every
  // render — status/focused/searchOpen/... all change during ordinary use.
  // Depending on it directly would tear the overlay down and recreate it
  // (a real NSWindow, via addon.destroy/create) on every such re-render
  // instead of only on session/enabled changes. Keeping the ref inside the
  // hook — rather than requiring every caller to useCallback it — is more
  // robust against a future caller forgetting to memoize.
  const onFailureRef = useRef(onFailure);
  useEffect(() => {
    onFailureRef.current = onFailure;
  });
  // Same reasoning as onFailureRef above, and for the same caller — kept as
  // a ref so a fresh `onAttached` identity on every render doesn't churn
  // this effect's dependency array.
  const onAttachedRef = useRef(onAttached);
  useEffect(() => {
    onAttachedRef.current = onAttached;
  });

  useEffect(() => {
    if (!enabled) return;
    const api = (window as Window & { electronNativeTerminal?: NativeTerminalBridge }).electronNativeTerminal;
    const el = ref.current;
    if (!api || !el) return;

    let cancelled = false;

    const measure = (): NativeOverlayRect => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    };

    // Temporary, paired with the host's ARGUS_NATIVE_TERM_DEBUG tracing: the
    // renderer's own view of the hole is the half that cannot be inferred from
    // main's logs. Enable from devtools with
    // `localStorage.argusNativeTermDebug = '1'` and reload.
    // Read per call, not once: main sets this flag after did-finish-load, which
    // can be after this effect has already run. Temporary debug code, and the
    // reports it guards are not hot enough for the localStorage hit to matter.
    const isDebug = () => {
      try { return localStorage.getItem('argusNativeTermDebug') === '1'; } catch { return false; }
    };

    const report = (reason?: unknown) => {
      const rect = measure();
      if (isDebug()) {
        const kind = Array.isArray(reason) && reason[0] && 'isIntersecting' in (reason[0] as object)
          ? 'intersection' : 'resize/scroll';
        console.log('[native-term:trace] measure', sessionId.slice(0, 8), kind, rect,
          'usable=', rect.width >= 40 && rect.height >= 40);
      }
      // A hole too small to be a real terminal is not a frame to apply — it
      // means the tile is not on screen: mid-mount, inside a display:none
      // container, or behind a maximized workbench (Cmd+E / Cmd+D). Two
      // separate things go wrong if this is reported as a position.
      //
      // Native is the resize authority, so the rect would drive the pty to
      // ~2 columns and make the agent reflow its entire transcript —
      // permanently, since that text lands in the scrollback. And the overlay
      // is its own NSWindow, so simply skipping the update leaves it floating
      // over unrelated UI (even outside the Argus window) at whatever
      // coordinates it last had.
      //
      // So report it as what it is — the hole is gone — and let main hide the
      // overlay until a real rect comes back. `lastRectKey` is deliberately
      // NOT updated: the next usable rect must be sent even if it equals the
      // last one we applied, since the overlay needs re-showing.
      if (rect.width < 40 || rect.height < 40) {
        api.setRect(sessionId, rect);
        return;
      }
      // Skip identical rects: layout effects fire on plenty of triggers that
      // don't move the hole, and each IPC hop is pure waste.
      const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
      if (key === lastRectKey.current) return;
      lastRectKey.current = key;
      api.setRect(sessionId, rect);
      registerOverlay(sessionId, rect);
    };

    // A tile can be hidden without its size changing and without unmounting —
    // a maximized workbench sets display:none on an ancestor, and
    // ResizeObserver does not fire for that on every engine. IntersectionObserver
    // does, and it is also what catches a tile scrolled out of the viewport.
    let io: IntersectionObserver | null = null;

    let ro: ResizeObserver | null = null;
    const initialRect = measure();
    void api.attach(sessionId, initialRect).then((ok) => {
      // The effect may have already been cleaned up (unmount, or `enabled`
      // flipped) by the time main replies — a stale resolution must not
      // install observers/listeners for a hole that's already gone, nor
      // fire onFailure for a session the caller has moved on from.
      if (cancelled) return;
      if (!ok) {
        onFailureRef.current?.();
        return;
      }
      // Seed with the rect we just attached with — not '' — so the first
      // ResizeObserver callback after attach doesn't immediately re-send an
      // identical rect through setRect (redundant IPC).
      lastRectKey.current = `${initialRect.x},${initialRect.y},${initialRect.width},${initialRect.height}`;
      registerOverlay(sessionId, initialRect);
      onAttachedRef.current?.();

      // Guard like the rest of the codebase (see Sessions.tsx) — jsdom under
      // Vitest has no ResizeObserver; attach/detach still work without it.
      ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(report) : null;
      ro?.observe(el);
      io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(report) : null;
      io?.observe(el);
      window.addEventListener('resize', report);
      window.addEventListener('scroll', report, true);
    });

    return () => {
      cancelled = true;
      ro?.disconnect();
      io?.disconnect();
      window.removeEventListener('resize', report);
      window.removeEventListener('scroll', report, true);
      api.detach(sessionId);
      unregisterOverlay(sessionId);
    };
  }, [sessionId, enabled]);

  return ref;
}
