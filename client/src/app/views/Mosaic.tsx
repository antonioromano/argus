import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { SessionInfo } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { Square as SquareIcon, Plus, CircleX, Minus, Check, Focus, ArrowDownToLine, Copy, GitCompare, FolderOpen, Terminal, RotateCcw } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { MinimizedChip } from '../ui/MinimizedChip.js';
import { TerminalShell } from '../ui/TerminalShell.js';
import { StatusPill, DirtyBadge, EmptyState, Button, IconButton, Tooltip } from '../../components/primitives/index.js';
import { ErrorBoundary } from '../../components/ErrorBoundary.js';
import { filterSessions } from '../../utils/sessionFilter.js';
import { shellLabel } from '../../utils/sessionLabel.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface MosaicProps {
  onOpenDiff?: (id: string) => void;
  sessions: SessionInfo[];
  /** Persist a new full ordering of session ids (mosaic-only order). */
  onReorder: (newOrderedIds: string[]) => void;
  filter: string;
  socket: TypedSocket;
  theme: 'dark' | 'light';
  /** When set, only these session ids stay as active tiles; the rest are forced-minimized. */
  groupFilterIds?: Set<string> | null;
  /** Active group id — resets the per-shell "force shown" override when the filter changes. */
  activeGroupId?: string | null;
  groupColorOf?: (sessionId: string) => string | null;
  toggleMinimize: (id: string) => void;
  restoreFromFilter: (id: string, currentGroup: string | null) => void;
  isMinimized: (id: string, groupFilterIds: Set<string> | null | undefined, activeGroupId: string | null | undefined) => boolean;
  onOpenSession: (id: string) => void;
  onCreate: () => void;
  onKill: (session: SessionInfo) => void;
  onRestart: (session: SessionInfo) => void;
  onMerge?: (session: SessionInfo) => void;
  onClone?: (session: SessionInfo) => void;
  onFocusDiff?: (id: string) => void;
  onFocusExplorer?: (id: string) => void;
  onFocusTerminal?: (id: string) => void;
  mergingSessionId?: string | null;
}

const MAX_TILES = 12;

export function Mosaic({ sessions, onReorder, filter, socket, theme, groupFilterIds, activeGroupId, groupColorOf, toggleMinimize, restoreFromFilter, isMinimized, onOpenSession, onCreate, onKill, onRestart, onMerge, onClone, onFocusDiff, onFocusExplorer, onFocusTerminal, mergingSessionId, onOpenDiff }: MosaicProps) {
  const filtered = useMemo(() => filterSessions(sessions, filter), [sessions, filter]);
  const currentGroup = activeGroupId ?? null;
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [windowFocused, setWindowFocused] = useState(true);
  // Tile just restored from the minimized row — its terminal should grab
  // keyboard focus on mount. Cleared once the xterm reports focus.
  const [restoreFocusId, setRestoreFocusId] = useState<string | null>(null);

  // Native HTML5 drag-to-reorder of tiles by their header. Operates on the full `sessions`
  // list (by id) so reorders stay correct even while filtered/grouped/sliced.
  const dragId = useRef<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const handleDragStart = (id: string) => { dragId.current = id; };
  const handleDragEnd = () => { dragId.current = null; setDropTargetId(null); };
  const handleDragOverTile = (id: string) => {
    if (dragId.current && dragId.current !== id) setDropTargetId(id);
  };
  const handleDropTile = (targetId: string) => {
    const src = dragId.current;
    dragId.current = null;
    setDropTargetId(null);
    if (!src || src === targetId) return;
    const ids = sessions.map((s) => s.id);
    const from = ids.indexOf(src);
    if (from === -1 || ids.indexOf(targetId) === -1) return;
    ids.splice(from, 1);
    ids.splice(ids.indexOf(targetId), 0, src);
    onReorder(ids);
  };

  useEffect(() => {
    const onFocus = () => setWindowFocused(true);
    const onBlur  = () => { setWindowFocused(false); setFocusedId(null); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  if (sessions.length === 0) {
    return (
      <div className="grid-bg argus-mosaic-empty">
        <EmptyState
          icon={SquareIcon}
          title="No shells yet"
          hint="Spin up your first agent. Pick a folder, pick an agent, you're off."
          action={
            <Button variant="primary" icon={Plus} onClick={onCreate}>
              New shell
            </Button>
          }
        />
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="grid-bg argus-mosaic-empty">
        <EmptyState
          icon={SquareIcon}
          title="No matching shells"
          hint={filter.trim()
            ? `Nothing matches "${filter.trim()}". Clear the filter to see all shells.`
            : 'No shells to display.'}
        />
      </div>
    );
  }

  const tiles = filtered.slice(0, MAX_TILES);
  const overflow = filtered.length > MAX_TILES;
  const minTiles = tiles.filter((s) => isMinimized(s.id, groupFilterIds, activeGroupId));
  const activeTiles = tiles.filter((s) => !isMinimized(s.id, groupFilterIds, activeGroupId));
  // Only count focus when an *active* tile is focused — minimized chips are exempt
  const activeFocusedId = (focusedId && activeTiles.some((t) => t.id === focusedId))
    ? focusedId
    : null;

  return (
    <div className="grid-bg" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: overflow ? 'auto' : 'hidden' }}>
      {minTiles.length > 0 && (
        <div className="argus-mosaic-minrow">
          {minTiles.map((s) => (
            <MinimizedChip
              key={s.id}
              session={s}
              onClick={() => {
                if (groupFilterIds) restoreFromFilter(s.id, currentGroup);
                else toggleMinimize(s.id);
                setRestoreFocusId(s.id);
              }}
              onDragStart={() => handleDragStart(s.id)}
              onDragOver={() => handleDragOverTile(s.id)}
              onDrop={() => handleDropTile(s.id)}
              onDragEnd={handleDragEnd}
              isDropTarget={dropTargetId === s.id}
            />
          ))}
        </div>
      )}
      {activeTiles.length > 0 && (
        <div className="argus-mosaic">
          {activeTiles.map((s, i) => (
            <MosaicTile
              key={s.id}
              idx={i}
              session={s}
              onDragStartTile={() => handleDragStart(s.id)}
              onDragOverTile={() => handleDragOverTile(s.id)}
              onDropTile={() => handleDropTile(s.id)}
              onDragEndTile={handleDragEnd}
              isDropTarget={dropTargetId === s.id}
              socket={socket}
              theme={theme}
              groupColor={groupColorOf?.(s.id) ?? null}
              isFocused={activeFocusedId === s.id}
              windowFocused={windowFocused}
              onXtermFocus={() => { setFocusedId(s.id); setRestoreFocusId(null); }}
              onXtermBlur={() => setFocusedId(null)}
              autoFocus={restoreFocusId === s.id}
              onToggleMinimize={() => toggleMinimize(s.id)}
              onOpen={() => onOpenSession(s.id)}
              onKill={() => onKill(s)}
              onRestart={() => onRestart(s)}
              onMerge={onMerge && s.worktreePath && mergingSessionId !== s.id ? () => onMerge(s) : undefined}
              onClone={onClone ? () => onClone(s) : undefined}
              onFocusDiff={onFocusDiff ? () => onFocusDiff(s.id) : undefined}
              onFocusExplorer={onFocusExplorer ? () => onFocusExplorer(s.id) : undefined}
              onFocusTerminal={onFocusTerminal ? () => onFocusTerminal(s.id) : undefined}
              onOpenDiff={onOpenDiff ? () => onOpenDiff(s.id) : undefined}
            />
          ))}
        </div>
      )}
      {overflow && (
        <div
          className="eyebrow"
          style={{
            flexShrink: 0,
            padding: 'var(--s-2) var(--s-4)',
            textAlign: 'center',
            color: 'var(--fg-3)',
            borderTop: '1px solid var(--line-1)',
          }}
        >
          + {filtered.length - MAX_TILES} more {filtered.length - MAX_TILES === 1 ? 'shell' : 'shells'} hidden — refine the filter or open from the sidebar
        </div>
      )}
    </div>
  );
}

function MosaicTile({
  idx,
  session,
  onDragStartTile,
  onDragOverTile,
  onDropTile,
  onDragEndTile,
  isDropTarget,
  socket,
  theme,
  groupColor,
  isFocused,
  windowFocused,
  onXtermFocus,
  onXtermBlur,
  autoFocus,
  onToggleMinimize,
  onOpen,
  onKill,
  onRestart,
  onMerge,
  onClone,
  onFocusDiff,
  onFocusExplorer,
  onFocusTerminal,
  onOpenDiff,
}: {
  idx: number;
  session: SessionInfo;
  onDragStartTile: () => void;
  onDragOverTile: () => void;
  onDropTile: () => void;
  onDragEndTile: () => void;
  isDropTarget: boolean;
  socket: TypedSocket;
  theme: 'dark' | 'light';
  groupColor?: string | null;
  isFocused: boolean;
  windowFocused: boolean;
  onXtermFocus: () => void;
  onXtermBlur: () => void;
  autoFocus?: boolean;
  onToggleMinimize: () => void;
  onOpen: () => void;
  onKill: () => void;
  onRestart: () => void;
  onMerge?: () => void;
  onClone?: () => void;
  onFocusDiff?: () => void;
  onFocusExplorer?: () => void;
  onFocusTerminal?: () => void;
  onOpenDiff?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    void navigator.clipboard.writeText(session.folderPath);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const copyPath = (e: React.MouseEvent) => { e.stopPropagation(); doCopy(); };
  return (
    <div
      className="argus-tile"
      data-status={session.status}
      style={{ ['--i' as string]: idx } as CSSProperties}
    >
      {(!isFocused || !windowFocused) && (
        <div className="argus-tile-overlay" />
      )}
      <div
        className="argus-tile-header"
        role="button"
        tabIndex={0}
        draggable
        data-drop-target={isDropTarget || undefined}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStartTile(); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOverTile(); }}
        onDrop={(e) => { e.preventDefault(); onDropTile(); }}
        onDragEnd={onDragEndTile}
      >
        <AgentGlyph agent={session.agentType} size={16} />
        {groupColor && (
          <span
            aria-hidden
            style={{ width: 7, height: 7, borderRadius: '50%', background: groupColor, flexShrink: 0 }}
          />
        )}
        <StatusPill status={session.status} size="sm" />
        <Tooltip content="Click to copy path">
          <span
            role="button"
            tabIndex={0}
            aria-label={copied ? 'Path copied' : `Copy path ${session.folderPath}`}
            onClick={copyPath}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); doCopy(); } }}
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
            {copied ? 'Copied path' : shellLabel(session)}
          </span>
        </Tooltip>
        <div style={{ flex: 1 }} />
        {session.hasGitChanges && <DirtyBadge size="sm" onClick={onOpenDiff ? (e?: React.MouseEvent) => { e?.stopPropagation(); onOpenDiff(); } : undefined} />}
        {onFocusDiff && (
          <IconButton
            icon={GitCompare}
            label="Open diff in focus"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onFocusDiff(); }}
          />
        )}
        {onFocusExplorer && (
          <IconButton
            icon={FolderOpen}
            label="Open files in focus"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onFocusExplorer(); }}
          />
        )}
        {onFocusTerminal && (
          <IconButton
            icon={Terminal}
            label="Open shell in focus"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onFocusTerminal(); }}
          />
        )}
        <div style={{ width: 1, height: 14, background: 'var(--line-2)', borderRadius: 1, flexShrink: 0, margin: '0 1px' }} />
        <IconButton
          icon={Minus}
          label="Minimize shell"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onToggleMinimize(); }}
        />
        <IconButton
          icon={Focus}
          label="Open in focus"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
        />
        {onClone && (
          <IconButton
            icon={Copy}
            label="Start a new shell from the same folder"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onClone(); }}
          />
        )}
        {onMerge && (
          <IconButton
            icon={ArrowDownToLine}
            label="Apply to project"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onMerge(); }}
          />
        )}
        <IconButton
          icon={RotateCcw}
          label="Restart shell"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onRestart(); }}
        />
        <IconButton
          icon={CircleX}
          label="Close shell"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onKill(); }}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <ErrorBoundary key={session.id} label={session.name}>
          <TerminalShell session={session} socket={socket} theme={theme} status={session.status} autoFocus={autoFocus} onFocusChange={(f) => f ? onXtermFocus() : onXtermBlur()} />
        </ErrorBoundary>
      </div>
    </div>
  );
}
