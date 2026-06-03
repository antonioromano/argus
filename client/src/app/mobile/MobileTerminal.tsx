import { useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { useTerminal } from '../../hooks/useTerminal.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface MobileTerminalProps {
  sessionId: string;
  socket: TypedSocket;
}

/** Read-only xterm view for mobile. Reuses the desktop terminal pipeline so the
 *  agent's full-screen TUI renders as one coherent, width-fitted screen. Input
 *  is handled separately by the on-screen keyboard (MobileKeyboard). */
export function MobileTerminal({ sessionId, socket }: MobileTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useTerminal(containerRef, { sessionId, socket, theme: 'dark', readOnly: true });

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        padding: '6px 8px',
        background: 'var(--bg-inset)',
        // Forward vertical drags to claude as scroll instead of bouncing the page.
        touchAction: 'none',
      }}
    />
  );
}
