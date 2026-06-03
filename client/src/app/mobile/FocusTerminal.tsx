import type { RefObject } from 'react';

interface FocusTerminalProps {
  /** Container the parent wires to `useTerminal`; xterm mounts here. */
  containerRef: RefObject<HTMLDivElement | null>;
}

/** Presentational xterm viewport for mobile. The parent (`Focus`) owns the
 *  `useTerminal` lifecycle so it can share the terminal handle with the KeyStrip.
 *  `touchAction: none` lets terminalMouse forward vertical drags as scroll. */
export function FocusTerminal({ containerRef }: FocusTerminalProps) {
  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        padding: '6px 8px',
        background: 'var(--bg-inset)',
        touchAction: 'none',
      }}
    />
  );
}
