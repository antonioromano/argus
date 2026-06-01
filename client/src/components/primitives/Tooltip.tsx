import { useState, useRef, useCallback, useEffect, cloneElement } from 'react';
import type { ReactElement, CSSProperties, MouseEvent as RMouseEvent, FocusEvent as RFocusEvent } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: string;
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  const show = useCallback((el: Element) => {
    bindGlobalListeners();
    timerRef.current = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      setCoords(getCoords(rect, position));
      setVisible(true);
    }, delay);
  }, [position, delay]);

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

  // After tooltip becomes visible, measure & clamp to viewport.
  useEffect(() => {
    if (!visible || !coords || !tooltipRef.current) return;
    const ttRect = tooltipRef.current.getBoundingClientRect();
    const clamped = clampToViewport(coords, { width: ttRect.width, height: ttRect.height });
    if (clamped.left !== coords.left || clamped.top !== coords.top) {
      setCoords(clamped);
    }
  }, [visible, coords]);

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
        padding: '4px 8px',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-tiny)',
        fontWeight: 500,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        boxShadow: 'var(--shadow-pop)',
        pointerEvents: 'none',
        opacity: visible ? 1 : 0,
        transition: 'opacity var(--dur-fast) var(--ease-std)',
      }
    : { display: 'none' };

  return (
    <>
      {cloned}
      {createPortal(
        <div ref={tooltipRef} role="tooltip" style={tooltipStyle}>{content}</div>,
        document.body,
      )}
    </>
  );
}
