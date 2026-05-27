import { useMemo, useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { Square as SquareIcon, Plus, PowerOff, Minus, Maximize2, Check, Focus } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { TerminalShell } from '../ui/TerminalShell.js';
import { StatusPill, DirtyBadge, EmptyState, Button, IconButton } from '../../components/primitives/index.js';
import { STATUS_COLORS } from '../../constants/status.js';
import { ErrorBoundary } from '../../components/ErrorBoundary.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface MosaicProps {
  onOpenDiff?: (id: string) => void;
  sessions: SessionInfo[];
  filter: string;
  socket: TypedSocket;
  theme: 'dark' | 'light';
  onOpenSession: (id: string) => void;
  onCreate: () => void;
  onKill: (session: SessionInfo) => void;
}

const MAX_TILES = 8;

/** Choose column count to keep tiles as large as possible for a given count. */
function colsForCount(n: number): number {
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  return 3;
}

function filterSessions(sessions: SessionInfo[], q: string): SessionInfo[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.filter((s) =>
    s.name.toLowerCase().includes(needle) ||
    s.folderPath.toLowerCase().includes(needle) ||
    s.agentType.toLowerCase().includes(needle),
  );
}

export function Mosaic({ sessions, filter, socket, theme, onOpenSession, onCreate, onKill, onOpenDiff }: MosaicProps) {
  const filtered = useMemo(() => filterSessions(sessions, filter), [sessions, filter]);
  const [minimized, setMinimized] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const toggleMinimize = (id: string) =>
    setMinimized((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (sessions.length === 0) {
    return (
      <div
        className="grid-bg"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-0)' }}
      >
        <EmptyState
          icon={SquareIcon}
          title="No sessions yet"
          hint="Spin up your first agent. Pick a folder, pick an agent, you're off."
          action={
            <Button variant="primary" icon={Plus} onClick={onCreate}>
              New session
            </Button>
          }
        />
      </div>
    );
  }

  const tiles = filtered.slice(0, MAX_TILES);
  const overflow = filtered.length > MAX_TILES;
  const minTiles = tiles.filter((s) => minimized.has(s.id));
  const activeTiles = tiles.filter((s) => !minimized.has(s.id));
  const cols = colsForCount(activeTiles.length);
  // Only count focus when an *active* tile is focused — minimized chips are exempt
  const activeFocusedId = (focusedId && activeTiles.some((t) => t.id === focusedId))
    ? focusedId
    : null;

  return (
    <div className="grid-bg" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: overflow ? 'auto' : 'hidden' }}>
      {minTiles.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-2)', padding: 'var(--s-3) var(--s-3) 0' }}>
          {minTiles.map((s) => (
            <MosaicTile
              key={s.id}
              session={s}
              socket={socket}
              theme={theme}
              minimized
              isFocused={false}
              hasFocusedSibling={false}
              onFocus={() => {}}
              onToggleMinimize={() => toggleMinimize(s.id)}
              onOpen={() => onOpenSession(s.id)}
              onKill={() => onKill(s)}
              onOpenDiff={onOpenDiff ? () => onOpenDiff(s.id) : undefined}
            />
          ))}
        </div>
      )}
      {activeTiles.length > 0 && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridAutoRows: '1fr',
            gap: 'var(--s-3)',
            padding: 'var(--s-3)',
          }}
        >
          {activeTiles.map((s) => (
            <MosaicTile
              key={s.id}
              session={s}
              socket={socket}
              theme={theme}
              minimized={false}
              isFocused={activeFocusedId === s.id}
              hasFocusedSibling={activeFocusedId !== null && activeFocusedId !== s.id}
              onFocus={() => setFocusedId(s.id)}
              onToggleMinimize={() => toggleMinimize(s.id)}
              onOpen={() => onOpenSession(s.id)}
              onKill={() => onKill(s)}
              onOpenDiff={onOpenDiff ? () => onOpenDiff(s.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MosaicTile({
  session,
  socket,
  theme,
  minimized,
  isFocused,
  hasFocusedSibling,
  onFocus,
  onToggleMinimize,
  onOpen,
  onKill,
  onOpenDiff,
}: {
  session: SessionInfo;
  socket: TypedSocket;
  theme: 'dark' | 'light';
  minimized: boolean;
  isFocused: boolean;
  hasFocusedSibling: boolean;
  onFocus: () => void;
  onToggleMinimize: () => void;
  onOpen: () => void;
  onKill: () => void;
  onOpenDiff?: () => void;
}) {
  const edge = STATUS_COLORS[session.status];
  const [copied, setCopied] = useState(false);
  const copyPath = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(session.folderPath);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div
      onPointerDown={onFocus}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        minWidth: 0,
        background: 'var(--bg-2)',
        border: `1px solid ${session.status === 'waiting' ? edge : 'var(--line-2)'}`,
        borderRadius: 'var(--r-2)',
        overflow: 'hidden',
        ...(minimized ? { width: 240, flexShrink: 0 } : {}),
      }}
    >
      {hasFocusedSibling && !isFocused && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.13)',
            borderRadius: 'var(--r-2)',
            pointerEvents: 'none',
            zIndex: 2,
            transition: 'opacity var(--dur-fast)',
          }}
        />
      )}
      <div
        role="button"
        tabIndex={0}
        onClick={minimized ? onToggleMinimize : onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); minimized ? onToggleMinimize() : onOpen(); } }}
        title={`Open ${session.folderPath}`}
        style={{
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          padding: 'var(--s-1) var(--s-3)',
          background: 'var(--bg-1)',
          borderBottom: minimized ? 'none' : '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        <AgentGlyph agent={session.agentType} size={16} />
        <span
          onClick={copyPath}
          title="Click to copy path"
          style={{
            flex: '0 1 auto',
            minWidth: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-tiny)',
            color: copied ? 'var(--accent)' : 'var(--fg-0)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {copied && <Check size={11} strokeWidth={2} />}
          {copied ? 'Copied path' : minimized ? session.name : session.folderPath}
        </span>
        <div style={{ flex: 1 }} />
        <StatusPill status={session.status} size="sm" />
        {session.hasGitChanges && <DirtyBadge size="sm" onClick={onOpenDiff ? (e?: React.MouseEvent) => { e?.stopPropagation(); onOpenDiff(); } : undefined} />}
        <IconButton
          icon={minimized ? Maximize2 : Minus}
          label={minimized ? 'Restore session' : 'Minimize session'}
          size="sm"
          onClick={(e) => { e.stopPropagation(); onToggleMinimize(); }}
        />
        <IconButton
          icon={Focus}
          label="Open in focus"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
        />
        <IconButton
          icon={PowerOff}
          label="Close session"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onKill(); }}
        />
      </div>

      {!minimized && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <ErrorBoundary key={session.id} label={session.name}>
            <TerminalShell session={session} socket={socket} theme={theme} status={session.status} />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
}
