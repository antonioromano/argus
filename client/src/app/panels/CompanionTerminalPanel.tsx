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
  width?: number;
}

export function CompanionTerminalPanel({
  session,
  socket,
  theme,
  width = 320,
}: CompanionTerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { terminalAlive } = useCompanionTerminal(containerRef, { sessionId: session.id, socket, theme });
  const termBg = 'var(--bg-inset)';

  return (
    <aside
      style={{
        width,
        flexShrink: 0,
        background: 'var(--bg-1)',
        borderLeft: '1px solid var(--line-2)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          padding: 'var(--s-1) var(--s-4)',
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
            padding: '6px 2px 2px 6px',
            position: 'relative',
          }}
        />
      </div>
    </aside>
  );
}
