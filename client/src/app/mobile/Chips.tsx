import { useRef, useEffect } from 'react';
import { type Chip, chipStyle } from './focusKeys.js';

interface ChipsProps {
  chips: Chip[];
  send: (data: string) => void;
}

/** Contextual quick-reply row (y/n · yes/no · CONTINUE). Renders nothing when the
 *  current prompt isn't recognized. Sits directly above the KeyStrip. */
export function Chips({ chips, send }: ChipsProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (rowRef.current) rowRef.current.scrollLeft = 0;
  }, [chips.length]);

  if (chips.length === 0) return null;

  return (
    <div
      ref={rowRef}
      className="mobile-chips-row"
      style={{
        display: 'flex',
        gap: 'var(--s-2)',
        padding: 'var(--s-2) var(--s-3)',
        overflowX: 'auto',
        scrollbarWidth: 'none',
        background: 'var(--bg-1)',
        borderTop: '1px solid var(--line-2)',
        flexShrink: 0,
        WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
      }}
    >
      {chips.map((c) => (
        <button
          key={c.label}
          onClick={() => send(c.value)}
          style={{
            padding: '0 var(--s-3)',
            minHeight: 44,
            borderRadius: 'var(--r-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-tiny)',
            letterSpacing: 'var(--tracking-eye)',
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            ...chipStyle(c.kind),
          }}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
