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

export function Tooltip({ content, children, position = 'top', delay = 400 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((el: Element) => {
    timerRef.current = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      setCoords(getCoords(rect, position));
      setVisible(true);
    }, delay);
  }, [position, delay]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

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
        zIndex: 300,
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
        <div role="tooltip" style={tooltipStyle}>{content}</div>,
        document.body,
      )}
    </>
  );
}
