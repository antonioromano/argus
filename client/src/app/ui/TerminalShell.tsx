import { useEffect, useRef } from 'react';
import type { SessionInfo, SessionStatus } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { useTerminal } from '../../hooks/useTerminal.js';
import { STATUS_COLORS } from '../../constants/status.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface TerminalShellProps {
  session: SessionInfo;
  socket: TypedSocket;
  theme: 'dark' | 'light';
  status?: SessionStatus;
}

/**
 * xterm.js container. Interior is fully owned by useTerminal — this wrapper
 * supplies the status-colored frame only. Refit via 'terminal:refit' window event.
 */
export function TerminalShell({ session, socket, theme, status }: TerminalShellProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useTerminal(containerRef, { sessionId: session.id, socket, theme });

  // Refit on focus enter so xterm cols/rows match
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('terminal:refit')), 50);
    return () => clearTimeout(t);
  }, [session.id]);

  const st = status ?? session.status;
  const edge = STATUS_COLORS[st];
  // Match xterm's own theme background so the sub-row gutter left by FitAddon's
  // whole-cell rounding (most visible at the bottom) blends in instead of
  // showing as a dark band.
  const termBg = theme === 'dark' ? '#1a1b26' : '#f5f5f5';

  return (
    <div
      ref={containerRef}
      className="terminal-panel"
      style={{
        flex: 1,
        minHeight: 0,
        background: termBg,
        border: `1px solid ${edge}`,
        borderRadius: 'var(--r-2)',
        overflow: 'hidden',
        boxShadow: st === 'waiting' ? `0 0 0 1px ${edge}, 0 0 18px var(--accent-glow)` : 'none',
        padding: '6px 2px 2px 6px',
        position: 'relative',
        transition: 'border-color var(--dur-fast), box-shadow var(--dur-fast)',
      }}
    />
  );
}
