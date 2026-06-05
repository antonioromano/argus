import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { SessionInfo } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { Square as SquareIcon, Plus, CircleX, Minus, Check, Focus, ArrowDownToLine, Copy, GitCompare, FolderOpen, Terminal, RotateCcw } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { TerminalShell } from '../ui/TerminalShell.js';
import { StatusPill, StatusDot, DirtyBadge, EmptyState, Button, IconButton, Tooltip } from '../../components/primitives/index.js';
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
            <div className="argus-mosaic">
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
                  onMerge={onMerge && s.worktreePath && mergingSessionId !== s.id ? () => onMerge(s) : undefined}
                  onClone={onClone ? () => onClone(s) : undefined}
                  onFocusDiff={onFocusDiff ? () => onFocusDiff(s.id) : undefined}
                  onFocusExplorer={onFocusExplorer ? () => onFocusExplorer(s.id) : undefined}
                  onFocusTerminal={onFocusTerminal ? () => onFocusTerminal(s.id) : undefined}
                  onOpenDiff={onOpenDiff ? () => onOpenDiff(s.id) : undefined}
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
  onMerge?: () => void;
  onClone?: () => void;
  onFocusDiff?: () => void;
  onFocusExplorer?: () => void;
  onFocusTerminal?: () => void;
  onOpenDiff?: () => void;
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
    <div ref={setNodeRef} style={style}>
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
  onMerge,
  onClone,
  onFocusDiff,
  onFocusExplorer,
  onFocusTerminal,
  onOpenDiff,
}: MosaicTileSharedProps & {
  dragHandleListeners?: ReturnType<typeof useSortable>['listeners'];
  dragHandleAttributes?: ReturnType<typeof useSortable>['attributes'];
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
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
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
