import { useState, useRef, useCallback, useEffect, useLayoutEffect, cloneElement } from 'react';
import type { ReactElement, ReactNode, CSSProperties, MouseEvent as RMouseEvent, FocusEvent as RFocusEvent } from 'react';
import { createPortal } from 'react-dom';
import { SuppressWhileMounted } from '../../hooks/useOverlaySuppression.js';
import { coversNativeOverlay } from '../../hooks/nativeOverlayRegistry.js';

interface TooltipProps {
  /** Usually a string; a node for a structured breakdown (e.g. the usage chip). */
  content: ReactNode;
  children: ReactElement<{
    onMouseEnter?: (e: RMouseEvent) => void;
    onMouseLeave?: (e: RMouseEvent) => void;
    onFocus?: (e: RFocusEvent) => void;
    onBlur?: (e: RFocusEvent) => void;
    [key: string]: unknown;
  }>;
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Show delay in ms. Default: 400 (web cadence; opt-in 1200 matches macOS HIToolTip). */
  delay?: number;
}

interface Coords {
  top: number;
  left: number;
  transformOrigin: string;
  translateX: string;
  translateY: string;
}

const VIEWPORT_PAD = 8;

// Module-level singleton: only one tooltip is ever visible app-wide. A second
// tooltip showing dismisses the first (covers nested triggers + focus/hover at
// once). Global scroll/resize dismiss the active one so it never floats stale.
let activeHide: (() => void) | null = null;
let globalListenersBound = false;

function bindGlobalListeners() {
  if (globalListenersBound || typeof window === 'undefined') return;
  globalListenersBound = true;
  const dismiss = () => activeHide?.();
  window.addEventListener('scroll', dismiss, true);
  window.addEventListener('resize', dismiss);
  // A drag starting after a tooltip showed would otherwise leave it floating.
  window.addEventListener('dragstart', dismiss, true);
}

function getCoords(rect: DOMRect, position: string): Coords {
  const GAP = 6;
  switch (position) {
    case 'bottom':
      return {
        top: rect.bottom + GAP,
        left: rect.left + rect.width / 2,
        transformOrigin: 'top center',
        translateX: '-50%',
        translateY: '0',
      };
    case 'left':
      return {
        top: rect.top + rect.height / 2,
        left: rect.left - GAP,
        transformOrigin: 'center right',
        translateX: '-100%',
        translateY: '-50%',
      };
    case 'right':
      return {
        top: rect.top + rect.height / 2,
        left: rect.right + GAP,
        transformOrigin: 'center left',
        translateX: '0',
        translateY: '-50%',
      };
    default: // top
      return {
        top: rect.top - GAP,
        left: rect.left + rect.width / 2,
        transformOrigin: 'bottom center',
        translateX: '-50%',
        translateY: '-100%',
      };
  }
}

type Position = 'top' | 'bottom' | 'left' | 'right';
const OPPOSITE: Record<Position, Position> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/** The asked-for side first, then its opposite, then the other two. */
function placementOrder(p: Position): Position[] {
  return [p, OPPOSITE[p], ...(['top', 'bottom', 'left', 'right'] as Position[]).filter((q) => q !== p && q !== OPPOSITE[p])];
}

/** The box a placement would occupy once translated and clamped. */
function boxAt(coords: Coords, tt: { width: number; height: number }) {
  const pct = (s: string) => (s.endsWith('%') ? parseFloat(s) / 100 : 0);
  return {
    x: coords.left + pct(coords.translateX) * tt.width,
    y: coords.top + pct(coords.translateY) * tt.height,
    width: tt.width,
    height: tt.height,
  };
}

function clampToViewport(
  coords: Coords,
  ttRect: { width: number; height: number },
): Coords {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Compute resolved top-left of tooltip box after translate.
  const parsePct = (s: string): number =>
    s.endsWith('%') ? parseFloat(s) / 100 : 0;
  const tx = parsePct(coords.translateX) * ttRect.width;
  const ty = parsePct(coords.translateY) * ttRect.height;
  let left = coords.left + tx;
  let top = coords.top + ty;
  const maxLeft = vw - ttRect.width - VIEWPORT_PAD;
  const maxTop = vh - ttRect.height - VIEWPORT_PAD;
  if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
  if (left > maxLeft) left = Math.max(VIEWPORT_PAD, maxLeft);
  if (top < VIEWPORT_PAD) top = VIEWPORT_PAD;
  if (top > maxTop) top = Math.max(VIEWPORT_PAD, maxTop);
  return {
    ...coords,
    left: left - tx,
    top: top - ty,
  };
}

export function Tooltip({ content, children, position = 'top', delay = 400 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  // Placement is settled before the bubble paints or suppresses anything.
  const [placed, setPlaced] = useState(false);
  // Every placement would cover a native terminal: the trigger's `title` shows
  // the OS tooltip instead, which macOS draws above every window.
  const [systemTip, setSystemTip] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  // undefined: nothing saved; null: the trigger had no title attribute.
  const savedTitle = useRef<string | null | undefined>(undefined);

  const restoreTitle = useCallback(() => {
    const el = triggerRef.current;
    if (!el || savedTitle.current === undefined) return;
    if (savedTitle.current === null) el.removeAttribute('title');
    else el.setAttribute('title', savedTitle.current);
    savedTitle.current = undefined;
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
    setPlaced(false);
    setSystemTip(false);
    restoreTitle();
  }, [restoreTitle]);

  const show = useCallback((el: Element) => {
    bindGlobalListeners();
    triggerRef.current = el;
    timerRef.current = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      setCoords(getCoords(rect, position));
      setPlaced(false);
      setVisible(true);
    }, delay);
  }, [position, delay]);

  useEffect(() => () => restoreTitle(), [restoreTitle]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Singleton registry: when this tooltip becomes visible it dismisses any other
  // visible tooltip and registers itself as the active one. Runs in an effect
  // (outside render), so a single tooltip is ever shown app-wide — covers nested
  // triggers and keyboard-focus + mouse-hover at the same time.
  useEffect(() => {
    if (!visible) return;
    if (activeHide && activeHide !== hide) activeHide();
    activeHide = hide;
    return () => { if (activeHide === hide) activeHide = null; };
  }, [visible, hide]);

  // Before paint: measure, then take the first placement (asked-for side,
  // its opposite, the other two) that fits the window without landing on a
  // native terminal. A tooltip must never hide a terminal just to show a hint.
  // If every side would, a plain-text tooltip falls back to the OS tooltip;
  // rich content keeps the asked-for side and hides what it covers.
  useLayoutEffect(() => {
    if (!visible || placed || !tooltipRef.current || !triggerRef.current) return;
    const tt = tooltipRef.current.getBoundingClientRect();
    const size = { width: tt.width, height: tt.height };
    const anchor = triggerRef.current.getBoundingClientRect();
    const candidates = placementOrder(position).map((p) => clampToViewport(getCoords(anchor, p), size));
    const clear = candidates.find((c) => !coversNativeOverlay(boxAt(c, size)));
    if (!clear && typeof content === 'string') {
      const el = triggerRef.current;
      if (savedTitle.current === undefined) savedTitle.current = el.getAttribute('title');
      el.setAttribute('title', content);
      setSystemTip(true);
    }
    setCoords(clear ?? candidates[0]);
    setPlaced(true);
  }, [visible, placed, position, content]);

  // eslint-disable-next-line react-hooks/refs -- cloneElement handler wiring; no hook ref is read during render (tooltipRef is only touched in effects)
  const cloned = cloneElement(children, {
    onMouseEnter: (e: RMouseEvent) => {
      show(e.currentTarget as Element);
      children.props.onMouseEnter?.(e);
    },
    onMouseLeave: (e: RMouseEvent) => {
      hide();
      children.props.onMouseLeave?.(e);
    },
    onFocus: (e: RFocusEvent) => {
      show(e.currentTarget as Element);
      children.props.onFocus?.(e);
    },
    onBlur: (e: RFocusEvent) => {
      hide();
      children.props.onBlur?.(e);
    },
  });

  const tooltipStyle: CSSProperties = coords
    ? {
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        transform: `translate(${coords.translateX}, ${coords.translateY})`,
        transformOrigin: coords.transformOrigin,
        zIndex: 'var(--z-tooltip)',
        background: 'var(--bg-3)',
        color: 'var(--fg-0)',
        border: '1px solid var(--line-3)',
        borderRadius: 'var(--r-2)',
        padding: 'var(--s-1) var(--s-2)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-tiny)',
        fontWeight: 500,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        boxShadow: 'var(--shadow-pop)',
        pointerEvents: 'none',
        opacity: visible && placed && !systemTip ? 1 : 0,
        transition: 'opacity var(--dur-fast) var(--ease)',
      }
    : { display: 'none' };

  return (
    <>
      {cloned}
      {createPortal(
        <div ref={tooltipRef} role="tooltip" style={tooltipStyle}>{content}</div>,
        document.body,
      )}
      {/* Tooltip wraps its trigger for that element's whole lifetime and never
          unmounts on hide/show — only `visible` toggles. A top-level
          useOverlaySuppression call would suppress from the trigger's first
          mount onward, not just while the bubble is actually shown. Gating
          SuppressWhileMounted on `visible` gives it the tooltip's real
          on-screen lifetime instead. */}
      {visible && placed && !systemTip && <SuppressWhileMounted target={() => tooltipRef.current?.getBoundingClientRect() ?? null} />}
    </>
  );
}
