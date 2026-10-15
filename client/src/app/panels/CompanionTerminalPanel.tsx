import { useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, SessionInfo } from '@argus/shared';
import { Terminal } from 'lucide-react';
import { useCompanionTerminal } from '../../hooks/useCompanionTerminal.js';
import { shellLabel } from '../../utils/sessionLabel.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface CompanionTerminalPanelProps {
  session: SessionInfo;
  socket: TypedSocket;
  theme: 'dark' | 'light';
  /** 'side' docks to the right of the conversation, 'bottom' below it (stacked layout). */
  placement?: 'side' | 'bottom';
  /** Width when docked to the side, height when docked to the bottom. */
  size?: number;
}

export function CompanionTerminalPanel({
  session,
  socket,
  theme,
  placement = 'side',
  size = 320,
}: CompanionTerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { terminalAlive } = useCompanionTerminal(containerRef, { sessionId: session.id, socket, theme });
  const termBg = theme === 'dark' ? '#1a1b26' : '#f5f5f5';

  return (
    <aside
      style={{
        // Docked below, the height is a preference: the panel shrinks when the
        // window is too short, so the conversation above keeps its min height.
        ...(placement === 'bottom'
          ? { height: size, flexShrink: 1, minHeight: 0, borderTop: '1px solid var(--line-2)' }
          : { width: size, flexShrink: 0, borderLeft: '1px solid var(--line-2)' }),
        background: 'var(--bg-1)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          height: 'var(--h-panel-header)',
          boxSizing: 'border-box',
          padding: '0 var(--s-4)',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        <Terminal size={13} strokeWidth={1.6} color="var(--fg-2)" />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-sm)',
            color: 'var(--fg-1)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {shellLabel(session)}
        </span>
        {!terminalAlive && (
          <span
            className="eyebrow"
            style={{ color: 'var(--danger)', fontSize: 'var(--t-micro)' }}
          >
            exited
          </span>
        )}
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          padding: 'var(--s-2)',
          background: termBg,
        }}
      >
        <div
          ref={containerRef}
          className="terminal-panel"
          style={{
            flex: 1,
            minHeight: 0,
            background: termBg,
            borderRadius: 'var(--r-2)',
            overflow: 'hidden',
            padding: '8px 14px 0px 14px',
            position: 'relative',
          }}
        />
      </div>
    </aside>
  );
}
