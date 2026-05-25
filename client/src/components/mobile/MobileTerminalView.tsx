import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { useSessions } from '../../hooks/useSessions.js';
import { AnsiTerminal, useTerminalBuffer } from './AnsiTerminal.js';
import { MobileActionBar } from './MobileActionBar.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface MobileTerminalViewProps {
  socket: TypedSocket;
  sessionId: string;
  onBack: () => void;
}

function StatusPill({ status }: { status: string }) {
  let bg: string;
  let color: string;
  let label: string;

  switch (status) {
    case 'running':
      bg = 'rgba(48,209,88,0.15)';
      color = '#30D158';
      label = 'Running';
      break;
    case 'waiting':
      bg = 'rgba(255,214,10,0.15)';
      color = '#FFD60A';
      label = 'Waiting';
      break;
    case 'exited':
      bg = 'rgba(255,255,255,0.07)';
      color = 'rgba(255,255,255,0.28)';
      label = 'Exited';
      break;
    default:
      bg = 'rgba(255,255,255,0.07)';
      color = 'rgba(255,255,255,0.45)';
      label = 'Idle';
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 10px',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 500,
        color,
        background: bg,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: color,
          display: 'inline-block',
        }}
      />
      {label}
    </span>
  );
}

// Internal component that has access to terminal buffer for lastRawLine
function TerminalViewInner({
  socket,
  sessionId,
  onBack,
}: MobileTerminalViewProps) {
  const { sessions } = useSessions(socket);
  const session = sessions.find((s) => s.id === sessionId);

  const { rawLines } = useTerminalBuffer(sessionId);

  // Get the last non-empty raw line for chip detection
  const lastRawLine = [...rawLines].reverse().find((l) => l.trim() !== '') ?? '';

  if (!session) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100dvh',
          background: '#1C1C1E',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.45)',
          fontSize: 15,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
        }}
      >
        Session not found
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        background: '#0D0D0F',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
        overflow: 'hidden',
      }}
    >
      {/* Nav bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          minHeight: 52,
          background: 'rgba(28,28,30,0.98)',
          borderBottom: '0.5px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          gap: 8,
        } as React.CSSProperties}
      >
        {/* Back button */}
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#0A84FF',
            fontSize: 15,
            padding: '4px 4px 4px 0',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexShrink: 0,
          }}
        >
          <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
            <path d="M8 14L2 8L8 2" stroke="#0A84FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Sessions
        </button>

        {/* Session name centered */}
        <div
          style={{
            flex: 1,
            textAlign: 'center',
            fontSize: 15,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.88)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {session.name}
        </div>

        {/* Status pill right */}
        <div style={{ flexShrink: 0 }}>
          <StatusPill status={session.status} />
        </div>
      </div>

      {/* Terminal body */}
      <AnsiTerminal
        sessionId={sessionId}
        style={{ flex: 1, minHeight: 0 }}
      />

      {/* Action bar */}
      <MobileActionBar session={session} lastRawLine={lastRawLine} />
    </div>
  );
}

export function MobileTerminalView(props: MobileTerminalViewProps) {
  return <TerminalViewInner {...props} />;
}
