import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { SessionInfo } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { Square as SquareIcon, Plus, PowerOff, Minus, Maximize2, Check, Focus, ArrowDownToLine, Copy, GitCompare, FolderOpen, Terminal } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { TerminalShell } from '../ui/TerminalShell.js';
import { StatusPill, DirtyBadge, EmptyState, Button, IconButton, Tooltip } from '../../components/primitives/index.js';
import { ErrorBoundary } from '../../components/ErrorBoundary.js';
import { filterSessions } from '../../utils/sessionFilter.js';
import { shellLabel } from '../../utils/sessionLabel.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface MosaicProps {
  onOpenDiff?: (id: string) => void;
  sessions: SessionInfo[];
  filter: string;
  socket: TypedSocket;
  theme: 'dark' | 'light';
  /** When set, only these session ids stay as active tiles; the rest are forced-minimized. */
  groupFilterIds?: Set<string> | null;
  /** Active group id — resets the per-shell "force shown" override when the filter changes. */
  activeGroupId?: string | null;
  groupColorOf?: (sessionId: string) => string | null;
  onOpenSession: (id: string) => void;
  onCreate: () => void;
  onKill: (session: SessionInfo) => void;
  onMerge?: (session: SessionInfo) => void;
  onClone?: (session: SessionInfo) => void;
  onFocusDiff?: (id: string) => void;
  onFocusExplorer?: (id: string) => void;
  onFocusTerminal?: (id: string) => void;
  mergingSessionId?: string | null;
}

const MAX_TILES = 12;
const EMPTY_SET: ReadonlySet<string> = new Set();

export function Mosaic({ sessions, filter, socket, theme, groupFilterIds, activeGroupId, groupColorOf, onOpenSession, onCreate, onKill, onMerge, onClone, onFocusDiff, onFocusExplorer, onFocusTerminal, mergingSessionId, onOpenDiff }: MosaicProps) {
  const filtered = useMemo(() => filterSessions(sessions, filter), [sessions, filter]);
  const [minimized, setMinimized] = useState<Set<string>>(new Set());
  // Shells the user clicked to pop back out of the filtered chip row (bypass the group filter).
  // Tagged with the group they belong to so they auto-reset when the active filter changes.
  const [forced, setForced] = useState<{ group: string | null; ids: Set<string> }>({ group: null, ids: new Set() });
  const currentGroup = activeGroupId ?? null;
  const forceShown = forced.group === currentGroup ? forced.ids : EMPTY_SET;
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [windowFocused, setWindowFocused] = useState(true);

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

  const toggleMinimize = (id: string) =>
    setMinimized((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const restoreFromFilter = (id: string) =>
    setForced((prev) => {
      const ids = new Set(prev.group === currentGroup ? prev.ids : []);
      ids.add(id);
      return { group: currentGroup, ids };
    });

  // With a group filter active, the filter alone decides visibility: members stay active
  // (even if hand-minimized), non-members collapse — unless force-shown by a chip click.
  // No filter → plain hand-minimize state.
  const isMinimized = (id: string) =>
    groupFilterIds ? (!groupFilterIds.has(id) && !forceShown.has(id)) : minimized.has(id);

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
  const minTiles = tiles.filter((s) => isMinimized(s.id));
  const activeTiles = tiles.filter((s) => !isMinimized(s.id));
  // Only count focus when an *active* tile is focused — minimized chips are exempt
  const activeFocusedId = (focusedId && activeTiles.some((t) => t.id === focusedId))
    ? focusedId
    : null;

  return (
    <div className="grid-bg" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: overflow ? 'auto' : 'hidden' }}>
      {minTiles.length > 0 && (
        <div className="argus-mosaic-minrow">
          {minTiles.map((s, i) => (
            <MosaicTile
              key={s.id}
              idx={i}
              session={s}
              socket={socket}
              theme={theme}
              groupColor={groupColorOf?.(s.id) ?? null}
              minimized
              isFocused={false}
              hasFocusedSibling={false}
              windowFocused={windowFocused}
              onFocus={() => {}}
              onToggleMinimize={groupFilterIds ? () => restoreFromFilter(s.id) : () => toggleMinimize(s.id)}
              onOpen={() => onOpenSession(s.id)}
              onKill={() => onKill(s)}
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
      {activeTiles.length > 0 && (
        <div className="argus-mosaic">
          {activeTiles.map((s, i) => (
            <MosaicTile
              key={s.id}
              idx={i}
              session={s}
              socket={socket}
              theme={theme}
              groupColor={groupColorOf?.(s.id) ?? null}
              minimized={false}
              isFocused={activeFocusedId === s.id}
              hasFocusedSibling={activeFocusedId !== null && activeFocusedId !== s.id}
              windowFocused={windowFocused}
              onFocus={() => setFocusedId(s.id)}
              onToggleMinimize={() => toggleMinimize(s.id)}
              onOpen={() => onOpenSession(s.id)}
              onKill={() => onKill(s)}
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
  socket,
  theme,
  groupColor,
  minimized,
  isFocused,
  hasFocusedSibling,
  windowFocused,
  onFocus,
  onToggleMinimize,
  onOpen,
  onKill,
  onMerge,
  onClone,
  onFocusDiff,
  onFocusExplorer,
  onFocusTerminal,
  onOpenDiff,
}: {
  idx: number;
  session: SessionInfo;
  socket: TypedSocket;
  theme: 'dark' | 'light';
  groupColor?: string | null;
  minimized: boolean;
  isFocused: boolean;
  hasFocusedSibling: boolean;
  windowFocused: boolean;
  onFocus: () => void;
  onToggleMinimize: () => void;
  onOpen: () => void;
  onKill: () => void;
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
      data-minimized={minimized || undefined}
      onPointerDown={onFocus}
      style={{ ['--i' as string]: idx } as CSSProperties}
    >
      {((hasFocusedSibling && !isFocused) || !windowFocused) && (
        <div className="argus-tile-overlay" />
      )}
      <div
        className="argus-tile-header"
        role="button"
        tabIndex={0}
        onClick={minimized ? onToggleMinimize : onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); minimized ? onToggleMinimize() : onOpen(); } }}
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
          icon={minimized ? Maximize2 : Minus}
          label={minimized ? 'Restore shell' : 'Minimize shell'}
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
          icon={PowerOff}
          label="Close shell"
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
