import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { SessionInfo, MosaicWaitingStyle } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { Square as SquareIcon, CircleX, Minus, Check, Maximize2, ArrowDownToLine, Copy, GitBranch, FolderOpen, Terminal, RotateCcw, CheckCircle2, Layers, MoreHorizontal } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { TerminalShell } from '../ui/TerminalShell.js';
import { StatusPill, StatusDot, EmptyState, IconButton, Tooltip } from '../../components/primitives/index.js';
import { Landing } from './Landing.js';
import { ErrorBoundary } from '../../components/ErrorBoundary.js';
import { filterSessions } from '../../utils/sessionFilter.js';
import { shellLabel } from '../../utils/sessionLabel.js';
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
  onOpenSession: (id: string) => void;
  onCreate: () => void;
  onKill: (session: SessionInfo) => void;
  onRestart: (session: SessionInfo) => void;
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
}

const MAX_TILES = 12;

export function Mosaic({ sessions, onReorder, filter, socket, theme, groupFilterIds, activeGroupId, groupColorOf, toggleMinimize, restoreFromFilter, restoreAll, isMinimized, onOpenSession, onCreate, onKill, onRestart, onMarkDone, onMerge, onClone, onFocusDiff, onFocusExplorer, onFocusTerminal, mergingSessionId, onOpenDiff, shortcuts, searchSessionId, onRequestSearch, onCloseSearch, onActiveTerminalChange, notifiedTileId, waitingStyle = 'breathing' }: MosaicProps) {
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
  const propCbRef = useRef({ onKill, onRestart, onMarkDone, onMerge, onClone, onFocusDiff, onFocusExplorer, onFocusTerminal, onOpenDiff, onOpenSession, onRequestSearch, onCloseSearch });
  useEffect(() => {
    propCbRef.current = { onKill, onRestart, onMarkDone, onMerge, onClone, onFocusDiff, onFocusExplorer, onFocusTerminal, onOpenDiff, onOpenSession, onRequestSearch, onCloseSearch };
  });

  const handleXtermFocus = useCallback((id: string) => { setFocusedId(id); setRestoreFocusId(null); }, []);
  const handleXtermBlur = useCallback(() => setFocusedId(null), []);
  const handleTileOpen = useCallback((id: string) => propCbRef.current.onOpenSession(id), []);
  const handleTileKill = useCallback((s: SessionInfo) => propCbRef.current.onKill(s), []);
  const handleTileRestart = useCallback((s: SessionInfo) => propCbRef.current.onRestart(s), []);
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
                  onClick={() => {
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
        <StatusPill status={session.status} size="sm" />
        <span
          style={{
            flex: '0 1 auto',
            minWidth: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-tiny)',
            color: 'var(--fg-0)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {shellLabel(session)}
        </span>
      </div>
    </div>
  );
}

// ─── SortableChip ────────────────────────────────────────────────────────────

function SortableChip({ session, onClick, isNew }: { session: SessionInfo; onClick: () => void; isNew?: boolean }) {
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

// ─── MosaicTile animation constants ──────────────────────────────────────────
const CTA_DUR = 200;
const CTA_STAGGER = 20;
const CTA_EASE = 'cubic-bezier(.42,0,.58,1)';
const CTA_TEXT_DELAY = Math.round(CTA_DUR * 0.65 + CTA_STAGGER * 3);

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
}: MosaicTileSharedProps & {
  dragHandleListeners?: ReturnType<typeof useSortable>['listeners'];
  dragHandleAttributes?: ReturnType<typeof useSortable>['attributes'];
}) {
  const [copied, setCopied] = useState(false);
  const [ctaHovered, setCtaHovered] = useState(false);
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
  const pathRef = useRef<HTMLSpanElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const tileRootRef = useRef<HTMLDivElement>(null);
  // Capture autoFocus at mount: true means this tile is being restored from the
  // minimized row and should skip the staggered entrance animation (which would
  // make it a ghost for up to idx*40ms due to the `backwards` fill mode delay).
  // Capture autoFocus once at mount via useState initializer (reading a ref's
  // .current during render is disallowed); the value never updates afterward.
  const [skipAnimation] = useState(autoFocus);
  const animTimeoutRef = useRef<number | null>(null);

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

  const handleCtaEnter = () => {
    const path = pathRef.current;
    const strip = stripRef.current;
    if (!path || !strip) return;
    if (animTimeoutRef.current !== null) {
      clearTimeout(animTimeoutRef.current);
      animTimeoutRef.current = null;
    }
    const icons = [...strip.children] as HTMLElement[];
    path.style.transitionDelay = '0ms';
    icons.forEach((el, i) => {
      el.style.pointerEvents = 'none';
      el.style.transition = `transform ${CTA_DUR}ms ${CTA_EASE} ${i * CTA_STAGGER}ms`;
      el.style.transform = 'translateX(0)';
    });
    const lastDone = CTA_DUR + (icons.length - 1) * CTA_STAGGER;
    animTimeoutRef.current = window.setTimeout(() => {
      icons.forEach(el => { el.style.pointerEvents = ''; });
      animTimeoutRef.current = null;
    }, lastDone);
    setCtaHovered(true);
  };

  const handleCtaLeave = () => {
    const path = pathRef.current;
    const strip = stripRef.current;
    if (!path || !strip) return;
    if (animTimeoutRef.current !== null) {
      clearTimeout(animTimeoutRef.current);
      animTimeoutRef.current = null;
    }
    const icons = [...strip.children] as HTMLElement[];
    icons.forEach((el, i) => {
      el.style.pointerEvents = 'none';
      const delay = (icons.length - 1 - i) * CTA_STAGGER;
      el.style.transition = `transform ${CTA_DUR}ms ${CTA_EASE} ${delay}ms`;
      el.style.transform = 'translateX(300px)';
    });
    path.style.transitionDelay = `${CTA_TEXT_DELAY}ms`;
    setCtaHovered(false);
  };
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
      <div
        className={`argus-tile-header${ctaHovered ? ' argus-tile-header--hovered' : ''}`}
        onMouseEnter={handleCtaEnter}
        onMouseLeave={handleCtaLeave}
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
        {/* pill stays outside swap zone; label collapses to dot on hover via CSS */}
        <StatusPill status={session.status} size="sm" />

        {/* swap zone: path slides out left, icons enter from right */}
        <div className="argus-tile-swap-zone">
          <span
            ref={pathRef}
            className="argus-tile-path"
          >
            <Tooltip content="Click to copy path">
              <span
                role="button"
                tabIndex={0}
                aria-label={copied ? 'Path copied' : `Copy path ${session.folderPath}`}
                onClick={copyPath}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); doCopy(); } }}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--t-tiny)',
                  color: copied ? 'var(--accent)' : 'var(--fg-0)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                {copied && <Check size={11} strokeWidth={2} />}
                {copied ? 'Copied path' : shellLabel(session)}
              </span>
            </Tooltip>
          </span>

          {/* icon strip — all start off-screen right via CSS; JS animates */}
          <div ref={stripRef} className="argus-tile-icon-strip">
            {/* unified git icon: amber when dirty, muted when clean */}
            <IconButton
              icon={GitBranch}
              label={session.hasGitChanges ? 'Open diff (has changes)' : 'No git changes'}
              size="sm"
              style={{ color: session.hasGitChanges ? 'var(--dirty)' : 'var(--fg-4)' }}
              onClick={(e) => { e.stopPropagation(); if (onFocusDiff) { onFocusDiff(session.id); } else { onOpenDiff?.(session.id); } }}
              disabled={!onFocusDiff && !onOpenDiff}
            />
            {onFocusExplorer && (
              <IconButton icon={FolderOpen} label="Open files in focus" size="sm"
                onClick={(e) => { e.stopPropagation(); onFocusExplorer(session.id); }} />
            )}
            {onFocusTerminal && (
              <IconButton icon={Terminal} label="Open shell in focus" size="sm"
                onClick={(e) => { e.stopPropagation(); onFocusTerminal(session.id); }} />
            )}
            {onMarkDone && canMarkDone && (
              <IconButton icon={CheckCircle2} label="Mark as done" size="sm"
                style={{ color: 'var(--status-done)' }}
                onClick={(e) => { e.stopPropagation(); onMarkDone(session); }} />
            )}
            <div style={{ width: 1, height: 14, background: 'var(--line-2)', borderRadius: 1, flexShrink: 0, margin: '0 1px' }} />
            <IconButton icon={Minus} label="Minimize shell" size="sm"
              onClick={(e) => { e.stopPropagation(); onToggleMinimize(session.id); }} />
            <IconButton icon={Maximize2} label="Open in focus" size="sm"
              onClick={(e) => { e.stopPropagation(); onOpen(session.id); }} />
            {onClone && (
              <IconButton icon={Copy} label="Start a new shell from the same folder" size="sm"
                onClick={(e) => { e.stopPropagation(); onClone(session); }} />
            )}
            {onMerge && canMerge && (
              <IconButton icon={ArrowDownToLine} label="Apply to project" size="sm"
                onClick={(e) => { e.stopPropagation(); onMerge(session); }} />
            )}
            <IconButton icon={RotateCcw} label="Restart shell" size="sm"
              onClick={(e) => { e.stopPropagation(); onRestart(session); }} />
            <IconButton icon={CircleX} label="Close shell" size="sm"
              onClick={(e) => { e.stopPropagation(); onKill(session); }} />
          </div>
        </div>

        {/* group triggers — hint at hidden actions; collapse on hover */}
        <div className="argus-tile-group-triggers" aria-hidden>
          <span className="argus-tile-gt"><Layers size={12} strokeWidth={1.6} /></span>
          <span className="argus-tile-gt"><MoreHorizontal size={12} strokeWidth={1.6} /></span>
        </div>
      </div>

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
