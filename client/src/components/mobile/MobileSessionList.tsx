import type { SessionInfo } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { useSessions } from '../../hooks/useSessions.js';
import { useNgrok } from '../../hooks/useNgrok.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface MobileSessionListProps {
  socket: TypedSocket;
  onSelectSession: (sessionId: string) => void;
  onRemoteAccess: () => void;
}

// Returns a human-readable relative time string like "2m ago", "1h ago", "3d ago"
function getTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(diffMs / 86_400_000);
  return `${days}d ago`;
}

function getStatusColor(status: SessionInfo['status']): string {
  switch (status) {
    case 'running': return '#30D158';
    case 'waiting': return '#FFD60A';
    default: return 'rgba(255,255,255,0.3)';
  }
}

function getStatusCircleBg(status: SessionInfo['status']): string {
  switch (status) {
    case 'running': return 'rgba(48,209,88,0.15)';
    case 'waiting': return 'rgba(255,214,10,0.15)';
    default: return 'rgba(255,255,255,0.07)';
  }
}

function getStatusText(session: SessionInfo): string {
  switch (session.status) {
    case 'running': return `Running · ${getTimeAgo(session.createdAt)}`;
    case 'waiting': return 'Waiting for input';
    case 'idle': return `Idle · ${getTimeAgo(session.createdAt)}`;
    case 'exited': return `Exited · ${getTimeAgo(session.createdAt)}`;
    default: return session.status;
  }
}

function SessionRow({
  session,
  onSelect,
}: {
  session: SessionInfo;
  onSelect: () => void;
}) {
  const circleBg = getStatusCircleBg(session.status);
  const statusColor = getStatusColor(session.status);
  const isWaiting = session.status === 'waiting';

  // Derive a short folder display name from the path
  const folderName = session.folderPath.split('/').filter(Boolean).pop() ?? session.folderPath;

  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        background: 'transparent',
        border: 'none',
        borderBottom: '0.5px solid rgba(255,255,255,0.08)',
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
      }}
    >
      {/* Status circle */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: circleBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        <span style={{ fontSize: 14, color: statusColor, lineHeight: 1 }}>
          {session.status === 'running' ? '●' : session.status === 'waiting' ? '●' : '○'}
        </span>
        {/* Pulsing dot overlay for waiting state */}
        {isWaiting && (
          <span
            style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              background: 'rgba(255,214,10,0.25)',
              animation: 'mobilePulse 1.5s ease-in-out infinite',
            }}
          />
        )}
      </div>

      {/* Session info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
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
        <div
          style={{
            fontSize: 12,
            color: 'rgba(255,255,255,0.45)',
            marginTop: 2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {folderName}
        </div>
      </div>

      {/* Status text */}
      <div
        style={{
          fontSize: 12,
          color: statusColor,
          flexShrink: 0,
          textAlign: 'right',
        }}
      >
        {getStatusText(session)}
      </div>
    </button>
  );
}

function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div
      style={{
        padding: '8px 16px 4px',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.06em',
        color: 'rgba(255,255,255,0.28)',
        textTransform: 'uppercase',
        background: '#161618',
      }}
    >
      {label} · {count}
    </div>
  );
}

export function MobileSessionList({ socket, onSelectSession, onRemoteAccess }: MobileSessionListProps) {
  const { sessions } = useSessions(socket);
  const { status: ngrokStatus } = useNgrok(socket);

  const isActive = (s: SessionInfo) => s.status === 'running' || s.status === 'waiting';
  const isInactive = (s: SessionInfo) => !isActive(s);

  // Active sessions: waiting first (needs attention), then running, then by createdAt desc
  const activeSessions = sessions
    .filter(isActive)
    .sort((a, b) => {
      if (a.status === 'waiting' && b.status !== 'waiting') return -1;
      if (b.status === 'waiting' && a.status !== 'waiting') return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const idleSessions = sessions
    .filter(isInactive)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const isEmpty = sessions.length === 0;

  const tunnelActive = ngrokStatus?.tunnelStatus === 'connected' && ngrokStatus.publicUrl;
  const truncatedUrl = tunnelActive
    ? ngrokStatus!.publicUrl!.replace(/^https?:\/\//, '').slice(0, 28) + (ngrokStatus!.publicUrl!.length > 32 ? '…' : '')
    : null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        background: '#1C1C1E',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
        overflow: 'hidden',
      }}
    >
      {/* Keyframes for pulse animation */}
      <style>{`
        @keyframes mobilePulse {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 0; transform: scale(1.4); }
        }
      `}</style>

      {/* Nav bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          height: 52,
          paddingTop: 'env(safe-area-inset-top, 0px)',
          background: 'rgba(28,28,30,0.98)',
          borderBottom: '0.5px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        <span
          style={{
            fontSize: 17,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.88)',
          }}
        >
          Argus
        </span>
        <button
          onClick={() => alert('Open Argus on your Mac to create sessions')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#0A84FF',
            fontSize: 22,
            lineHeight: 1,
            padding: '4px 0 4px 12px',
            display: 'flex',
            alignItems: 'center',
          }}
          aria-label="New session"
        >
          +
        </button>
      </div>

      {/* Session list */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
        {isEmpty ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '60%',
              padding: '0 32px',
              textAlign: 'center',
              color: 'rgba(255,255,255,0.28)',
              fontSize: 15,
            }}
          >
            No sessions. Open Argus on your Mac to create sessions.
          </div>
        ) : (
          <>
            {activeSessions.length > 0 && (
              <div>
                <GroupHeader label="ACTIVE" count={activeSessions.length} />
                {activeSessions.map((s) => (
                  <SessionRow key={s.id} session={s} onSelect={() => onSelectSession(s.id)} />
                ))}
              </div>
            )}

            {idleSessions.length > 0 && (
              <div>
                <GroupHeader label="IDLE" count={idleSessions.length} />
                {idleSessions.map((s) => (
                  <SessionRow key={s.id} session={s} onSelect={() => onSelectSession(s.id)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom bar */}
      <div
        style={{
          padding: '12px 16px',
          paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
          background: 'rgba(28,28,30,0.98)',
          borderTop: '0.5px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          flexShrink: 0,
        }}
      >
        {tunnelActive ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                flex: 1,
                fontSize: 13,
                color: '#30D158',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#30D158',
                  marginRight: 6,
                  verticalAlign: 'middle',
                }}
              />
              {truncatedUrl}
            </div>
            <button
              onClick={onRemoteAccess}
              style={{
                background: '#0A84FF',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '7px 16px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Share
            </button>
          </div>
        ) : (
          <button
            onClick={onRemoteAccess}
            style={{
              width: '100%',
              background: 'rgba(10,132,255,0.12)',
              color: '#0A84FF',
              border: '1px solid rgba(10,132,255,0.3)',
              borderRadius: 10,
              padding: '11px 16px',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Enable Remote Access
          </button>
        )}
      </div>
    </div>
  );
}
