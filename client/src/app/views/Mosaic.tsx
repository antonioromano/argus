import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { SessionInfo, MosaicWaitingStyle, TileQuickAction, TileRunningIndicator } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { Square as SquareIcon, CircleX, Minus, Check, Maximize2, MoreHorizontal } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { TerminalShell } from '../ui/TerminalShell.js';
import { StatusDot, EmptyState, IconButton, Tooltip, ContextMenu } from '../../components/primitives/index.js';
import type { ContextMenuEntry } from '../../components/primitives/index.js';
import { STATUS_LABELS } from '../../constants/status.js';
import { DEFAULT_TILE_QUICK_ACTION, tileActionMeta } from '../../constants/tileActions.js';
import { Landing } from './Landing.js';
import { ErrorBoundary } from '../../components/ErrorBoundary.js';
import { filterSessions } from '../../utils/sessionFilter.js';
import { shellLabel } from '../../utils/sessionLabel.js';
import { buildSessionMenuItems } from '../ui/sessionMenu.js';
import { useSessionMenu } from '../ui/sessionMenuContext.js';
import { SessionRenameInput } from '../ui/SessionRenameInput.js';
import { mosaicLayout } from '../../utils/mosaicLayout.js';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ResolvedShortcuts } from '../../keyboard/useShortcuts.js';
import type { ShortcutActionId } from '../../keyboard/registry.js';
import { formatCombo } from '../../keyboard/combo.js';

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
  restoreAll: (ids: string[], currentGroup: string | null) => void;
  isMinimized: (id: string, groupFilterIds: Set<string> | null | undefined, activeGroupId: string | null | undefined) => boolean;
  /** True when a session is owned by a different window (multi-window). */
  isForeign: (id: string) => boolean;
  /** Label of the window that owns a foreign session, for the chip badge. */
  foreignLabel: (id: string) => string;
  /** Jump to (focus) the window that owns a foreign session. */
  onFocusForeign: (id: string) => void;
  onOpenSession: (id: string) => void;
  /** Dragged past the window edge and released outside → spawn a new window owning it. */
  onTearOff: (sessionId: string) => void;
  onCreate: () => void;
  onKill: (session: SessionInfo) => void;
  onRestart: (session: SessionInfo) => void;
  onDumpDiagnostics: (session: SessionInfo) => void;
  /** Show the per-tile diagnostics button (gated by the developer-tools setting). */
  showDiagnostics: boolean;
  onMarkDone?: (session: SessionInfo) => void;
  onMerge?: (session: SessionInfo) => void;
  onClone?: (session: SessionInfo) => void;
  onFocusDiff?: (id: string) => void;
  onFocusExplorer?: (id: string) => void;
  onFocusTerminal?: (id: string) => void;
  mergingSessionId?: string | null;
  shortcuts?: ResolvedShortcuts;
  /** Session id whose terminal search bar is open (null = none). */
  searchSessionId?: string | null;
  /** Open the search bar for a given session's terminal. */
  onRequestSearch?: (id: string) => void;
  /** Close the open search bar. */
  onCloseSearch?: () => void;
  /** Report which tile's terminal currently holds keyboard focus (null when none). */
  onActiveTerminalChange?: (id: string | null) => void;
  /** Session id to highlight + focus via notification click (null = none). */
  notifiedTileId?: string | null;
  /** Visual treatment for a waiting-for-input tile (default: breathing). */
  waitingStyle?: MosaicWaitingStyle;
  /** The one configurable action pinned in each tile header (default: diff). */
  quickAction?: TileQuickAction;
  /** Progress hairline under the header while running (default: hairline). */
  runningIndicator?: TileRunningIndicator;
}

const MAX_TILES = 12;

export function Mosaic({ sessions, onReorder, filter, socket, theme, groupFilterIds, activeGroupId, groupColorOf, toggleMinimize, restoreFromFilter, restoreAll, isMinimized, isForeign, foreignLabel, onFocusForeign, onOpenSession, onTearOff, onCreate, onKill, onRestart, onDumpDiagnostics, showDiagnostics, onMarkDone, onMerge, onClone, onFocusDiff, onFocusExplorer, onFocusTerminal, mergingSessionId, onOpenDiff, shortcuts, searchSessionId, onRequestSearch, onCloseSearch, onActiveTerminalChange, notifiedTileId, waitingStyle = 'breathing', quickAction = DEFAULT_TILE_QUICK_ACTION, runningIndicator = 'hairline' }: MosaicProps) {
  const filtered = useMemo(() => filterSessions(sessions, filter), [sessions, filter]);
  const activeTileCount = useMemo(() => {
    const ts = filtered.slice(0, MAX_TILES);
    return ts.filter(s => !isMinimized(s.id, groupFilterIds, activeGroupId)).length;
  }, [filtered, isMinimized, groupFilterIds, activeGroupId]);
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('terminal:refit')), 150);
    return () => clearTimeout(t);
  }, [activeTileCount]);
  const currentGroup = activeGroupId ?? null;
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [windowFocused, setWindowFocused] = useState(true);
  // Tile just restored from the minimized row — its terminal should grab
  // keyboard focus on mount. Cleared once the xterm reports focus.
  const [restoreFocusId, setRestoreFocusId] = useState<string | null>(null);

  // Animation state for genie minimize/restore
  const [minimizingIds, setMinimizingIds] = useState<Set<string>>(new Set());
  const [restoringIds,  setRestoringIds]  = useState<Set<string>>(new Set());
  const [newChipIds,    setNewChipIds]    = useState<Set<string>>(new Set());
  const [reflowingIds,  setReflowingIds]  = useState<Set<string>>(new Set());

  // @dnd-kit active ids — one per container
  const [activeTileId, setActiveTileId] = useState<string | null>(null);
  const [activeChipId, setActiveChipId] = useState<string | null>(null);

  // @dnd-kit sensors for tiles
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Mirror the values the (stable) tile handlers close over into refs, so the
  // handlers can be wrapped in useCallback([]) without going stale. This lets
  // React.memo on the tile actually short-circuit — the handler identity no
  // longer changes every parent render. Animation behavior is unchanged.
  const handlerStateRef = useRef({ filtered, groupFilterIds, activeGroupId, minimizingIds, isMinimized, toggleMinimize, restoreFromFilter, currentGroup });
  useEffect(() => {
    handlerStateRef.current = { filtered, groupFilterIds, activeGroupId, minimizingIds, isMinimized, toggleMinimize, restoreFromFilter, currentGroup };
  });

  const handleMinimize = useCallback((id: string) => {
    const { filtered, groupFilterIds, activeGroupId, minimizingIds, isMinimized, toggleMinimize } = handlerStateRef.current;
    setMinimizingIds(prev => new Set([...prev, id]));
    setTimeout(() => {
      const remaining = filtered
        .slice(0, MAX_TILES)
        .filter(s => !isMinimized(s.id, groupFilterIds, activeGroupId) && s.id !== id && !minimizingIds.has(s.id))
        .map(s => s.id);
      toggleMinimize(id);
      setMinimizingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      setNewChipIds(prev => new Set([...prev, id]));
      setReflowingIds(new Set(remaining));
      setTimeout(() => {
        setNewChipIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        setReflowingIds(new Set());
      }, 540);
    }, 340);
  }, []);

  const handleRestore = useCallback((id: string) => {
    const { groupFilterIds, toggleMinimize, restoreFromFilter, currentGroup } = handlerStateRef.current;
    if (groupFilterIds) restoreFromFilter(id, currentGroup);
    else toggleMinimize(id);
    setRestoringIds(prev => new Set([...prev, id]));
    setTimeout(() => {
      setRestoringIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    }, 400);
  }, []);

  // Stable per-tile callbacks. Parent-supplied callbacks may change identity on
  // every parent render; mirror them through a ref so the wrappers below stay
  // referentially stable and the memoized tile only re-renders on real changes.
  const propCbRef = useRef({ onKill, onRestart, onDumpDiagnostics, onMarkDone, onMerge, onClone, onFocusDiff, onFocusExplorer, onFocusTerminal, onOpenDiff, onOpenSession, onRequestSearch, onCloseSearch });
  useEffect(() => {
    propCbRef.current = { onKill, onRestart, onDumpDiagnostics, onMarkDone, onMerge, onClone, onFocusDiff, onFocusExplorer, onFocusTerminal, onOpenDiff, onOpenSession, onRequestSearch, onCloseSearch };
  });

  const handleXtermFocus = useCallback((id: string) => { setFocusedId(id); setRestoreFocusId(null); }, []);
  const handleXtermBlur = useCallback(() => setFocusedId(null), []);
  const handleTileOpen = useCallback((id: string) => propCbRef.current.onOpenSession(id), []);
  const handleTileKill = useCallback((s: SessionInfo) => propCbRef.current.onKill(s), []);
  const handleTileRestart = useCallback((s: SessionInfo) => propCbRef.current.onRestart(s), []);
  const handleTileDumpDiagnostics = useCallback((s: SessionInfo) => propCbRef.current.onDumpDiagnostics(s), []);
  const handleTileMarkDone = useCallback((s: SessionInfo) => propCbRef.current.onMarkDone?.(s), []);
  const handleTileMerge = useCallback((s: SessionInfo) => propCbRef.current.onMerge?.(s), []);
  const handleTileClone = useCallback((s: SessionInfo) => propCbRef.current.onClone?.(s), []);
  const handleTileFocusDiff = useCallback((id: string) => propCbRef.current.onFocusDiff?.(id), []);
  const handleTileFocusExplorer = useCallback((id: string) => propCbRef.current.onFocusExplorer?.(id), []);
  const handleTileFocusTerminal = useCallback((id: string) => propCbRef.current.onFocusTerminal?.(id), []);
  const handleTileOpenDiff = useCallback((id: string) => propCbRef.current.onOpenDiff?.(id), []);
  const handleTileOpenSearch = useCallback((id: string) => propCbRef.current.onRequestSearch?.(id), []);
  const handleTileCloseSearch = useCallback(() => propCbRef.current.onCloseSearch?.(), []);

  const handleTileDragStart = (event: DragStartEvent) => {
    setActiveTileId(event.active.id as string);
  };

  const handleTileDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    // Tear-off: pointer released outside the window → move to a new window.
    const activator = event.activatorEvent as PointerEvent | undefined;
    if (activator && typeof activator.clientX === 'number') {
      const x = activator.clientX + event.delta.x;
      const y = activator.clientY + event.delta.y;
      const out = x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight;
      if (out && !over) {
        onTearOff(active.id as string);
        setActiveTileId(null);
        return;
      }
    }
    if (!over || active.id === over.id) {
      setActiveTileId(null);
      return;
    }
    const ids = sessions.map((s) => s.id);
    const oldIdx = ids.indexOf(active.id as string);
    const newIdx = ids.indexOf(over.id as string);
    onReorder(arrayMove(ids, oldIdx, newIdx));
    setActiveTileId(null);
  };

  const handleChipDragStart = (event: DragStartEvent) => {
    setActiveChipId(event.active.id as string);
  };

  const handleChipDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) { setActiveChipId(null); return; }
    // Recompute minimized IDs at event time to avoid stale closure
    const allTiles = filterSessions(sessions, filter).slice(0, MAX_TILES);
    const minIds = allTiles.filter((s) => isMinimized(s.id, groupFilterIds, activeGroupId)).map((s) => s.id);
    const oldIdx = minIds.indexOf(active.id as string);
    const newIdx = minIds.indexOf(over.id as string);
    if (oldIdx === -1 || newIdx === -1) { setActiveChipId(null); return; }
    const newMinIds = arrayMove(minIds, oldIdx, newIdx);
    // Rebuild full order: keep tile positions, reorder chips among themselves
    let chipIdx = 0;
    const newIds = sessions.map((s) => minIds.includes(s.id) ? newMinIds[chipIdx++] : s.id);
    onReorder(newIds);
    setActiveChipId(null);
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

  useEffect(() => {
    if (!focusedId) return;
    const s = sessions.find((s) => s.id === focusedId);
    if (s?.status === 'done') socket.emit('session:seen', focusedId);
  }, [focusedId, sessions, socket]);

  // Report the focused tile up so Cmd+W / Cmd+F can target the active terminal.
  // A minimized tile renders no terminal, so a focused tile is always an active one.
  useEffect(() => { onActiveTerminalChange?.(focusedId); }, [focusedId, onActiveTerminalChange]);

  if (sessions.length === 0) {
    return (
      <div className="grid-bg argus-mosaic-empty">
        <Landing mode="empty" minimizedCount={0} onCreate={onCreate} onRestoreAll={() => {}} />
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
  const activeTileIds = activeTiles.map((s) => s.id);
  // Fill the grid: uniform when the count tiles cleanly, stretched partial rows otherwise.
  const layout = mosaicLayout(activeTiles.length);
  const minTileIds = minTiles.map((s) => s.id);
  // Only count focus when an *active* tile is focused — minimized chips are exempt
  const activeFocusedId = (focusedId && activeTiles.some((t) => t.id === focusedId))
    ? focusedId
    : null;

  const draggingSession = activeTileId ? sessions.find((s) => s.id === activeTileId) ?? null : null;
  const draggingChip = activeChipId ? sessions.find((s) => s.id === activeChipId) ?? null : null;

  return (
    <div className="grid-bg" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: overflow ? 'auto' : 'hidden' }}>
      {minTiles.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleChipDragStart}
          onDragEnd={handleChipDragEnd}
        >
          <SortableContext items={minTileIds} strategy={rectSortingStrategy}>
            <div className="argus-mosaic-minrow">
              {minTiles.map((s) => (
                <SortableChip
                  key={s.id}
                  session={s}
                  isNew={newChipIds.has(s.id)}
                  windowBadge={isForeign(s.id) ? foreignLabel(s.id) : undefined}
                  onClick={isForeign(s.id)
                    ? () => onFocusForeign(s.id)
                    : () => {
                        handleRestore(s.id);
                        setRestoreFocusId(s.id);
                      }}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {draggingChip ? <ChipDragPreview session={draggingChip} /> : null}
          </DragOverlay>
        </DndContext>
      )}
      {activeTiles.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleTileDragStart}
          onDragEnd={handleTileDragEnd}
        >
          <SortableContext items={activeTileIds} strategy={rectSortingStrategy}>
            <div
              className="argus-mosaic"
              data-waiting-style={waitingStyle}
              style={{
                gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
                gridAutoFlow: 'column',
              }}
            >
              {activeTiles.map((s, i) => (
                <SortableMosaicTile
                  key={s.id}
                  idx={i}
                  rowSpan={layout.rowSpans[i]}
                  session={s}
                  socket={socket}
                  theme={theme}
                  groupColor={groupColorOf?.(s.id) ?? null}
                  isFocused={activeFocusedId === s.id}
                  windowFocused={windowFocused}
                  onXtermFocus={handleXtermFocus}
                  onXtermBlur={handleXtermBlur}
                  autoFocus={restoreFocusId === s.id}
                  onToggleMinimize={handleMinimize}
                  isMinimizing={minimizingIds.has(s.id)}
                  isRestoring={restoringIds.has(s.id)}
                  isReflowing={reflowingIds.has(s.id)}
                  onOpen={handleTileOpen}
                  onKill={handleTileKill}
                  onRestart={handleTileRestart}
                  onDumpDiagnostics={handleTileDumpDiagnostics}
                  showDiagnostics={showDiagnostics}
                  onMarkDone={onMarkDone ? handleTileMarkDone : undefined}
                  canMarkDone={!!onMarkDone && s.status === 'idle'}
                  onMerge={onMerge ? handleTileMerge : undefined}
                  canMerge={!!onMerge && !!s.worktreePath && mergingSessionId !== s.id}
                  onClone={onClone ? handleTileClone : undefined}
                  onFocusDiff={onFocusDiff ? handleTileFocusDiff : undefined}
                  onFocusExplorer={onFocusExplorer ? handleTileFocusExplorer : undefined}
                  onFocusTerminal={onFocusTerminal ? handleTileFocusTerminal : undefined}
                  onOpenDiff={onOpenDiff ? handleTileOpenDiff : undefined}
                  shortcuts={shortcuts}
                  searchOpen={searchSessionId === s.id}
                  onOpenSearch={onRequestSearch ? handleTileOpenSearch : undefined}
                  onCloseSearch={onCloseSearch ? handleTileCloseSearch : undefined}
                  isNotified={notifiedTileId === s.id}
                  quickAction={quickAction}
                  runningIndicator={runningIndicator}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {draggingSession ? (
              <TileDragPreview session={draggingSession} theme={theme} />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
      {activeTiles.length === 0 && (
        <Landing
          mode="all-minimized"
          minimizedCount={minTiles.length}
          onCreate={onCreate}
          onRestoreAll={() => restoreAll(minTileIds, currentGroup)}
        />
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

// ─── SortableMosaicTile ───────────────────────────────────────────────────────

type MosaicTileSharedProps = {
  idx: number;
  /** Number of grid row tracks this tile spans (fills leftover space vertically). */
  rowSpan: number;
  session: SessionInfo;
  socket: TypedSocket;
  theme: 'dark' | 'light';
  groupColor?: string | null;
  isFocused: boolean;
  windowFocused: boolean;
  // Focus reporting takes the session id so the parent callback can stay stable.
  onXtermFocus: (id: string) => void;
  onXtermBlur: () => void;
  autoFocus?: boolean;
  // Session-taking handlers: the tile passes its own `session`/`id`, letting the
  // parent supply stable (useCallback) references so React.memo can short-circuit.
  onToggleMinimize: (id: string) => void;
  isMinimizing?: boolean;
  isRestoring?: boolean;
  isReflowing?: boolean;
  onOpen: (id: string) => void;
  onKill: (session: SessionInfo) => void;
  onRestart: (session: SessionInfo) => void;
  onDumpDiagnostics: (session: SessionInfo) => void;
  showDiagnostics: boolean;
  /** Mark-as-done handler; gated by `canMarkDone` for whether the button shows. */
  onMarkDone?: (session: SessionInfo) => void;
  canMarkDone?: boolean;
  /** Merge handler; gated by `canMerge` for whether the button shows. */
  onMerge?: (session: SessionInfo) => void;
  canMerge?: boolean;
  onClone?: (session: SessionInfo) => void;
  onFocusDiff?: (id: string) => void;
  onFocusExplorer?: (id: string) => void;
  onFocusTerminal?: (id: string) => void;
  onOpenDiff?: (id: string) => void;
  shortcuts?: ResolvedShortcuts;
  searchOpen?: boolean;
  /** Open this tile's terminal search bar; receives the session id so the parent can stay stable. */
  onOpenSearch?: (id: string) => void;
  onCloseSearch?: () => void;
  /** True while this tile is the notification-click target; triggers glow + terminal focus. */
  isNotified?: boolean;
  /** Pinned header action + running-progress treatment, both from config. */
  quickAction: TileQuickAction;
  runningIndicator: TileRunningIndicator;
};

function SortableMosaicTile(props: MosaicTileSharedProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.session.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div ref={setNodeRef} style={{ ...style, minWidth: 0, gridRow: `span ${props.rowSpan}` }}>
      <MosaicTile
        {...props}
        dragHandleListeners={listeners}
        dragHandleAttributes={attributes}
      />
    </div>
  );
}

// ─── TileDragPreview ──────────────────────────────────────────────────────────

function TileDragPreview({ session }: { session: SessionInfo; theme: 'dark' | 'light' }) {
  return (
    <div className="argus-tile argus-tile-drag-overlay" data-status={session.status}>
      <div className="argus-tile-header">
        <AgentGlyph agent={session.agentType} size={16} />
        <StatusDot status={session.status} size={7} />
        <span className="argus-tile-name" style={{ color: 'var(--fg-0)' }}>{shellLabel(session)}</span>
        <span className="argus-tile-status argus-status" data-status={session.status}>
          {STATUS_LABELS[session.status]}
        </span>
      </div>
    </div>
  );
}

// ─── SortableChip ────────────────────────────────────────────────────────────

function SortableChip({ session, onClick, isNew, windowBadge }: { session: SessionInfo; onClick: () => void; isNew?: boolean; windowBadge?: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: session.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };
  return (
    <button
      ref={setNodeRef}
      className={isNew ? 'argus-chip argus-chip--entering' : 'argus-chip'}
      style={style}
      onClick={onClick}
      {...listeners}
      {...attributes}
    >
      <StatusDot status={session.status} size={6} />
      <AgentGlyph agent={session.agentType} size={14} />
      <span className="argus-chip-label">{session.name}</span>
      {windowBadge && <span className="argus-chip-window-badge">{windowBadge}</span>}
      {session.hasGitChanges && <span className="argus-chip-dirty" />}
    </button>
  );
}

// ─── ChipDragPreview ──────────────────────────────────────────────────────────

function ChipDragPreview({ session }: { session: SessionInfo }) {
  return (
    <button type="button" className="argus-chip argus-chip-drag-overlay">
      <StatusDot status={session.status} size={6} />
      <AgentGlyph agent={session.agentType} size={14} />
      <span className="argus-chip-label">{session.name}</span>
      {session.hasGitChanges && <span className="argus-chip-dirty" />}
    </button>
  );
}

// ─── MosaicTile ───────────────────────────────────────────────────────────────

function MosaicTileInner({
  idx,
  session,
  dragHandleListeners,
  dragHandleAttributes,
  socket,
  theme,
  groupColor,
  isFocused,
  windowFocused,
  onXtermFocus,
  onXtermBlur,
  autoFocus,
  isNotified,
  onToggleMinimize,
  isMinimizing,
  isRestoring,
  isReflowing,
  onOpen,
  onKill,
  onRestart,
  onDumpDiagnostics,
  showDiagnostics,
  onMarkDone,
  canMarkDone,
  onMerge,
  canMerge,
  onClone,
  onFocusDiff,
  onFocusExplorer,
  onFocusTerminal,
  onOpenDiff,
  shortcuts,
  searchOpen,
  onOpenSearch,
  onCloseSearch,
  quickAction,
  runningIndicator,
}: MosaicTileSharedProps & {
  dragHandleListeners?: ReturnType<typeof useSortable>['listeners'];
  dragHandleAttributes?: ReturnType<typeof useSortable>['attributes'];
}) {
  const [copied, setCopied] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const sessionMenu = useSessionMenu();
  // Stable wrapper so TerminalShell's memo isn't busted by a fresh closure here.
  const sessionId = session.id;
  const handleFocusChange = useCallback(
    (f: boolean) => { if (f) onXtermFocus(sessionId); else onXtermBlur(); },
    [onXtermFocus, onXtermBlur, sessionId],
  );
  // TerminalShell's onOpenSearch is no-arg; bind this tile's id here.
  const handleOpenSearch = useCallback(
    () => onOpenSearch?.(sessionId),
    [onOpenSearch, sessionId],
  );
  const tileRootRef = useRef<HTMLDivElement>(null);
  // Capture autoFocus at mount: true means this tile is being restored from the
  // minimized row and should skip the staggered entrance animation (which would
  // make it a ghost for up to idx*40ms due to the `backwards` fill mode delay).
  // Capture autoFocus once at mount via useState initializer (reading a ref's
  // .current during render is disallowed); the value never updates afterward.
  const [skipAnimation] = useState(autoFocus);

  // Notification-click: scroll into view and increment focusToken to request xterm focus.
  const [focusToken, setFocusToken] = useState(0);
  const prevNotified = useRef(false);
  useEffect(() => {
    if (isNotified && !prevNotified.current) {
      tileRootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setFocusToken((t) => t + 1);
    }
    prevNotified.current = !!isNotified;
  }, [isNotified]);
  const doCopy = () => {
    void navigator.clipboard.writeText(session.folderPath);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const copyPath = (e: React.MouseEvent) => { e.stopPropagation(); doCopy(); };

  // ⋯ overflow menu. Opened by click (never hover), anchored under the button.
  // Click-driven state cannot be stranded: ContextMenu closes on Escape, outside
  // mousedown, window blur, and resize.
  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuAt({ x: r.right - 200, y: r.bottom + 4 });
  };
  const closeMenu = useCallback(() => setMenuAt(null), []);

  // Menu and tooltip labels come from the live binding, so a rebind in settings
  // cannot leave the ⋯ menu advertising a key that no longer does anything.
  const comboLabel = (id: ShortcutActionId): string | undefined =>
    shortcuts ? formatCombo(shortcuts[id]) : undefined;

  // Same list the right-click menu builds, so Rename and every other action stay
  // in lockstep between the ⋯ button and the header's context menu.
  const menuItems: ContextMenuEntry[] = buildSessionMenuItems(
    session,
    {
      onRename: () => sessionMenu.beginRename(session.id, 'tile'),
      onOpen, onKill, onRestart, onToggleMinimize,
      onDumpDiagnostics, showDiagnostics,
      onMarkDone, canMarkDone: () => !!canMarkDone,
      onMerge, canMerge: () => !!canMerge,
      onClone,
      onFocusDiff, onFocusExplorer, onFocusTerminal, onOpenDiff,
    },
    shortcuts,
  );

  // The one configurable pinned action. 'none' collapses the slot; the action
  // itself never disappears — it is always in the ⋯ menu above.
  const quickMeta = quickAction === 'none' ? null : tileActionMeta(quickAction);
  const quickHandlers: Record<Exclude<TileQuickAction, 'none'>, { run: () => void; available: boolean }> = {
    diff:    { run: () => { if (onFocusDiff) onFocusDiff(session.id); else onOpenDiff?.(session.id); }, available: !!(onFocusDiff || onOpenDiff) },
    files:   { run: () => onFocusExplorer?.(session.id), available: !!onFocusExplorer },
    shell:   { run: () => onFocusTerminal?.(session.id), available: !!onFocusTerminal },
    clone:   { run: () => onClone?.(session),            available: !!onClone },
    restart: { run: () => onRestart(session),            available: true },
    done:    { run: () => onMarkDone?.(session),         available: !!onMarkDone && !!canMarkDone },
    apply:   { run: () => onMerge?.(session),            available: !!onMerge && !!canMerge },
  };
  const quick = quickMeta ? quickHandlers[quickMeta.id as Exclude<TileQuickAction, 'none'>] : null;
  const quickCombo = quickMeta?.shortcutId ? comboLabel(quickMeta.shortcutId) : undefined;

  const tileClass = [
    'argus-tile',
    isMinimizing && 'argus-tile--minimizing',
    isRestoring  && 'argus-tile--restoring',
    isReflowing  && 'argus-tile--reflowing',
    isNotified   && 'argus-tile--notified',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={tileRootRef}
      className={tileClass}
      data-status={session.status}
      style={{ ['--i' as string]: idx, ...(skipAnimation && !isRestoring ? { animation: 'none' } : {}) } as CSSProperties}
    >
      {(!isFocused || !windowFocused) && (
        <div className="argus-tile-overlay" />
      )}
      {/* Header: identity is permanent. Nothing here ever slides, so no hover
          state can strand the name off-screen (the pre-0.22 swap could). */}
      <div
        className="argus-tile-header"
        {...dragHandleListeners}
        {...dragHandleAttributes}
      >
        <AgentGlyph agent={session.agentType} size={16} />
        {groupColor && (
          <span
            aria-hidden
            style={{ width: 7, height: 7, borderRadius: '50%', background: groupColor, flexShrink: 0 }}
          />
        )}
        <StatusDot status={session.status} size={7} />

        {sessionMenu.isRenaming(session.id, 'tile') ? (
          <SessionRenameInput
            initial={shellLabel(session)}
            onCommit={(v) => sessionMenu.commitRename(session.id, v)}
            onCancel={sessionMenu.cancelRename}
            style={{ flex: '0 1 220px', fontSize: 'var(--t-sm)' }}
          />
        ) : (
          <Tooltip content="Click to copy path · right-click for actions">
            <span
              role="button"
              tabIndex={0}
              className="argus-tile-name"
              aria-label={copied ? 'Path copied' : `Copy path ${session.folderPath}`}
              onClick={copyPath}
              onContextMenu={(e) => sessionMenu.openMenu(session, e, 'tile')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); doCopy(); } }}
              style={{ color: copied ? 'var(--accent)' : 'var(--fg-0)' }}
            >
              {copied && <Check size={11} strokeWidth={2} style={{ flexShrink: 0 }} />}
              {copied ? 'Copied path' : shellLabel(session)}
            </span>
          </Tooltip>
        )}

        {session.worktreeBranch && (
          <Tooltip content={session.worktreeBranch}>
            <span className="argus-tile-branch">{session.worktreeBranch.replace(/^argus\//, '')}</span>
          </Tooltip>
        )}
        {session.hasGitChanges && (
          <Tooltip content="Uncommitted changes">
            <span className="argus-tile-dirty" />
          </Tooltip>
        )}

        <span className="argus-tile-status argus-status" data-status={session.status}>
          {STATUS_LABELS[session.status]}
        </span>

        {/* [action] ┃ [minimize] [expand] [close] ┃ [⋯] — a rule per group: the
            pinned action, the window controls, the menu. ⋯ sits last so its popup
            lines up with the tile's right edge instead of hanging inside it. The
            leading rule is dropped with the action it separates ('none'). Close
            is the third window control, as in a real title bar; it carries no
            standing red — `hover-danger` colors it only on hover, so a benign
            header has no permanent alarm in it. */}
        <div className="argus-tile-actions">
          {quickMeta && quick && (
            <>
              <IconButton
                icon={quickMeta.icon}
                label={quickMeta.id === 'diff' && session.hasGitChanges
                  ? 'Diff — has changes'
                  : `${quickMeta.label}${quickCombo ? `  ${quickCombo}` : ''}`}
                size="sm"
                style={quickMeta.id === 'diff'
                  ? { color: session.hasGitChanges ? 'var(--dirty)' : undefined }
                  : undefined}
                disabled={!quick.available}
                onClick={(e) => { e.stopPropagation(); quick.run(); }}
              />
              <span className="argus-tile-winsep" aria-hidden />
            </>
          )}
          <IconButton icon={Minus} label="Minimize to chip row" size="sm"
            onClick={(e) => { e.stopPropagation(); onToggleMinimize(session.id); }} />
          <IconButton icon={Maximize2} label="Expand to focus view" size="sm"
            onClick={(e) => { e.stopPropagation(); onOpen(session.id); }} />
          <IconButton
            icon={CircleX}
            label={`Close shell${comboLabel('close-shell') ? `  ${comboLabel('close-shell')}` : ''}`}
            size="sm"
            className="hover-danger"
            onClick={(e) => { e.stopPropagation(); onKill(session); }}
          />
          <span className="argus-tile-winsep" aria-hidden />
          <IconButton
            icon={MoreHorizontal}
            label="More actions"
            size="sm"
            onClick={openMenu}
          />
        </div>

        {runningIndicator === 'hairline' && session.status === 'running' && (
          <span className="argus-tile-prog" aria-hidden><i /></span>
        )}
      </div>

      {menuAt && <ContextMenu x={menuAt.x} y={menuAt.y} items={menuItems} onClose={closeMenu} />}

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <ErrorBoundary key={session.id} label={session.name}>
          <TerminalShell session={session} socket={socket} theme={theme} status={session.status} autoFocus={autoFocus} onFocusChange={handleFocusChange} shortcuts={shortcuts} searchOpen={searchOpen} onOpenSearch={onOpenSearch ? handleOpenSearch : undefined} onCloseSearch={onCloseSearch} requestFocusToken={focusToken} />
        </ErrorBoundary>
      </div>
    </div>
  );
}

// Memoized leaf: the Mosaic parent re-renders on every focus / window-focus /
// animation-set change, but each tile should only re-render when its own props
// actually change. All handler props are stabilized in the parent (useCallback
// + ref mirroring), so a shallow prop compare short-circuits unrelated renders.
const MosaicTile = memo(MosaicTileInner);
