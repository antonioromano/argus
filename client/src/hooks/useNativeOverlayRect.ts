import { useEffect, useRef } from 'react';

interface NativeOverlayRect { x: number; y: number; width: number; height: number }

interface NativeTerminalBridge {
  available: () => Promise<boolean>;
  attach: (sessionId: string, rect: NativeOverlayRect) => void;
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
 */
export function useNativeOverlayRect(sessionId: string, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const lastRectKey = useRef<string>('');

  useEffect(() => {
    if (!enabled) return;
    const api = (window as Window & { electronNativeTerminal?: NativeTerminalBridge }).electronNativeTerminal;
    const el = ref.current;
    if (!api || !el) return;

    const measure = (): NativeOverlayRect => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    };

    const report = () => {
      const rect = measure();
      // Skip identical rects: layout effects fire on plenty of triggers that
      // don't move the hole, and each IPC hop is pure waste.
      const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
      if (key === lastRectKey.current) return;
      lastRectKey.current = key;
      api.setRect(sessionId, rect);
    };

    const initialRect = measure();
    api.attach(sessionId, initialRect);
    // Seed with the rect we just attached with — not '' — so the first
    // ResizeObserver callback after attach doesn't immediately re-send an
    // identical rect through setRect (redundant IPC).
    lastRectKey.current = `${initialRect.x},${initialRect.y},${initialRect.width},${initialRect.height}`;

    // Guard like the rest of the codebase (see Sessions.tsx) — jsdom under
    // Vitest has no ResizeObserver; attach/detach still work without it.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(report) : null;
    ro?.observe(el);
    window.addEventListener('resize', report);
    window.addEventListener('scroll', report, true);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', report);
      window.removeEventListener('scroll', report, true);
      api.detach(sessionId);
    };
  }, [sessionId, enabled]);

  return ref;
}
