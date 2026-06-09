import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { SessionInfo } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { Square as SquareIcon, CircleX, Minus, Check, Focus, ArrowDownToLine, Copy, GitBranch, FolderOpen, Terminal, RotateCcw, CheckCircle2, Layers, MoreHorizontal } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { TerminalShell } from '../ui/TerminalShell.js';
import { StatusPill, StatusDot, EmptyState, IconButton, Tooltip } from '../../components/primitives/index.js';
import { Landing } from './Landing.js';
import { ErrorBoundary } from '../../components/ErrorBoundary.js';
import { filterSessions } from '../../utils/sessionFilter.js';
import { shellLabel } from '../../utils/sessionLabel.js';
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
}

const MAX_TILES = 12;

export function Mosaic({ sessions, onReorder, filter, socket, theme, groupFilterIds, activeGroupId, groupColorOf, toggleMinimize, restoreFromFilter, restoreAll, isMinimized, onOpenSession, onCreate, onKill, onRestart, onMarkDone, onMerge, onClone, onFocusDiff, onFocusExplorer, onFocusTerminal, mergingSessionId, onOpenDiff, shortcuts, searchSessionId, onRequestSearch, onCloseSearch, onActiveTerminalChange }: MosaicProps) {
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

  // @dnd-kit active ids — one per container
  const [activeTileId, setActiveTileId] = useState<string | null>(null);
  const [activeChipId, setActiveChipId] = useState<string | null>(null);

  // @dnd-kit sensors for tiles
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
                  onClick={() => {
                    if (groupFilterIds) restoreFromFilter(s.id, currentGroup);
                    else toggleMinimize(s.id);
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
              style={{
                gridTemplateColumns: `repeat(${Math.min(activeTiles.length, 3)}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${Math.ceil(activeTiles.length / Math.min(activeTiles.length, 3))}, minmax(0, 1fr))`,
              }}
            >
              {activeTiles.map((s, i) => (
                <SortableMosaicTile
                  key={s.id}
                  idx={i}
                  session={s}
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
                  onMarkDone={onMarkDone && s.status === 'idle' ? () => onMarkDone(s) : undefined}
                  onMerge={onMerge && s.worktreePath && mergingSessionId !== s.id ? () => onMerge(s) : undefined}
                  onClone={onClone ? () => onClone(s) : undefined}
                  onFocusDiff={onFocusDiff ? () => onFocusDiff(s.id) : undefined}
                  onFocusExplorer={onFocusExplorer ? () => onFocusExplorer(s.id) : undefined}
                  onFocusTerminal={onFocusTerminal ? () => onFocusTerminal(s.id) : undefined}
                  onOpenDiff={onOpenDiff ? () => onOpenDiff(s.id) : undefined}
                  shortcuts={shortcuts}
                  searchOpen={searchSessionId === s.id}
                  onOpenSearch={onRequestSearch ? () => onRequestSearch(s.id) : undefined}
                  onCloseSearch={onCloseSearch}
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
  session: SessionInfo;
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
  onMarkDone?: () => void;
  onMerge?: () => void;
  onClone?: () => void;
  onFocusDiff?: () => void;
  onFocusExplorer?: () => void;
  onFocusTerminal?: () => void;
  onOpenDiff?: () => void;
  shortcuts?: ResolvedShortcuts;
  searchOpen?: boolean;
  onOpenSearch?: () => void;
  onCloseSearch?: () => void;
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
    <div ref={setNodeRef} style={{ ...style, minWidth: 0 }}>
      <MosaicTile
        {...props}
        dragHandleListeners={listeners}
        dragHandleAttributes={attributes}
      />
    </div>
  );
}

// ─── TileDragPreview ──────────────────────────────────────────────────────────

function TileDragPreview({ session, theme: _theme }: { session: SessionInfo; theme: 'dark' | 'light' }) {
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

function SortableChip({ session, onClick }: { session: SessionInfo; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: session.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };
  return (
    <button
      ref={setNodeRef}
      className="argus-chip"
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

function MosaicTile({
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
  onToggleMinimize,
  onOpen,
  onKill,
  onRestart,
  onMarkDone,
  onMerge,
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
  const pathRef = useRef<HTMLSpanElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  // Capture autoFocus at mount: true means this tile is being restored from the
  // minimized row and should skip the staggered entrance animation (which would
  // make it a ghost for up to idx*40ms due to the `backwards` fill mode delay).
  const skipAnimation = useRef(autoFocus).current;
  const animTimeoutRef = useRef<number | null>(null);
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
  return (
    <div
      className="argus-tile"
      data-status={session.status}
      style={{ ['--i' as string]: idx, ...(skipAnimation ? { animation: 'none' } : {}) } as CSSProperties}
    >
      {(!isFocused || !windowFocused) && (
        <div className="argus-tile-overlay" />
      )}
      <div
        className={`argus-tile-header${ctaHovered ? ' argus-tile-header--hovered' : ''}`}
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
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
              onClick={(e) => { e.stopPropagation(); if (onFocusDiff) { onFocusDiff(); } else { onOpenDiff?.(); } }}
              disabled={!onFocusDiff && !onOpenDiff}
            />
            {onFocusExplorer && (
              <IconButton icon={FolderOpen} label="Open files in focus" size="sm"
                onClick={(e) => { e.stopPropagation(); onFocusExplorer(); }} />
            )}
            {onFocusTerminal && (
              <IconButton icon={Terminal} label="Open shell in focus" size="sm"
                onClick={(e) => { e.stopPropagation(); onFocusTerminal(); }} />
            )}
            {onMarkDone && (
              <IconButton icon={CheckCircle2} label="Mark as done" size="sm"
                style={{ color: 'var(--status-done)' }}
                onClick={(e) => { e.stopPropagation(); onMarkDone(); }} />
            )}
            <div style={{ width: 1, height: 14, background: 'var(--line-2)', borderRadius: 1, flexShrink: 0, margin: '0 1px' }} />
            <IconButton icon={Minus} label="Minimize shell" size="sm"
              onClick={(e) => { e.stopPropagation(); onToggleMinimize(); }} />
            <IconButton icon={Focus} label="Open in focus" size="sm"
              onClick={(e) => { e.stopPropagation(); onOpen(); }} />
            {onClone && (
              <IconButton icon={Copy} label="Start a new shell from the same folder" size="sm"
                onClick={(e) => { e.stopPropagation(); onClone(); }} />
            )}
            {onMerge && (
              <IconButton icon={ArrowDownToLine} label="Apply to project" size="sm"
                onClick={(e) => { e.stopPropagation(); onMerge(); }} />
            )}
            <IconButton icon={RotateCcw} label="Restart shell" size="sm"
              onClick={(e) => { e.stopPropagation(); onRestart(); }} />
            <IconButton icon={CircleX} label="Close shell" size="sm"
              onClick={(e) => { e.stopPropagation(); onKill(); }} />
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
          <TerminalShell session={session} socket={socket} theme={theme} status={session.status} autoFocus={autoFocus} onFocusChange={(f) => f ? onXtermFocus() : onXtermBlur()} shortcuts={shortcuts} searchOpen={searchOpen} onOpenSearch={onOpenSearch} onCloseSearch={onCloseSearch} />
        </ErrorBoundary>
      </div>
    </div>
  );
}
