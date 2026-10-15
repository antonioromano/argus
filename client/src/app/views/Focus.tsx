import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { SessionInfo, TerminalEngine, TileRunningIndicator, MosaicOrientation } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { Terminal, Copy, GitCompare, FolderOpen, Minimize2, CircleX, RotateCcw, ChevronUp, Bug, Activity } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { ShellGitChip } from '../ui/ShellGitChip.js';
import { UsageChip } from '../ui/UsageChip.js';
import { PrChip } from '../ui/PrChip.js';
import { StaleChip } from '../ui/StaleChip.js';
import { workRoot } from '../../utils/workRoot.js';
import { ChipStrip } from '../ui/ChipStrip.js';
import { ReplyBar } from '../ui/ReplyBar.js';
import { TerminalShell } from '../ui/TerminalShell.js';
import { ExitedCard } from '../ui/ExitedCard.js';
import { ModalPlaceholder } from '../ui/ModalPlaceholder.js';
import { useFullScreenSuppressed } from '../../hooks/useFullScreenSuppressed.js';
import { useOverlayHidden } from '../../hooks/useOverlayHidden.js';
import { StatusPill, DirtyBadge, Button, IconButton, Tooltip, Spinner } from '../../components/primitives/index.js';
import { shellLabel } from '../../utils/sessionLabel.js';
import { useSessionMenu } from '../ui/sessionMenuContext.js';
import { SessionRenameInput } from '../ui/SessionRenameInput.js';
import { CompanionTerminalPanel } from '../panels/CompanionTerminalPanel.js';
import { ActivityPanel } from '../panels/ActivityPanel.js';
import { useNativeTerminalAvailable, resolveTerminalEngine } from '../../hooks/useNativeEngine.js';
// Monaco-backed workbench panels are lazy-loaded so the heavy editor bundle is
// only fetched when a user actually opens the code explorer / diff view
// (e.g. /mobile never mounts these).
const DiffWorkbench = lazy(() =>
  import('../panels/DiffWorkbench.js').then((m) => ({ default: m.DiffWorkbench })),
);
const ExplorerWorkbench = lazy(() =>
  import('../panels/ExplorerWorkbench.js').then((m) => ({ default: m.ExplorerWorkbench })),
);
import { ResizeDivider } from '../../components/ResizeDivider.js';
import { ErrorBoundary } from '../../components/ErrorBoundary.js';
import type { SidePanel } from '../types.js';
import type { ResolvedShortcuts } from '../../keyboard/useShortcuts.js';

const SIDE_PANEL_WIDTH_KEY = 'argus.focus.sidePanelWidth';
const SIDE_PANEL_MIN = 240;
const SIDE_PANEL_MAX = 720;
const SIDE_PANEL_DEFAULT = 320;
// Stacked layout: the companion shell docks under the conversation instead.
const BOTTOM_PANEL_HEIGHT_KEY = 'argus.focus.bottomPanelHeight';
const BOTTOM_PANEL_MIN = 120;
const BOTTOM_PANEL_MAX = 720;
const BOTTOM_PANEL_DEFAULT = 280;
// The conversation keeps at least this much height when the shell is docked
// below it; the stored shell height is a preference that yields to it.
const CONVERSATION_MIN_HEIGHT = 200;
const PEEK_HEIGHT = 34;

function readStoredSize(key: string, min: number, max: number, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const readStoredWidth = () => readStoredSize(SIDE_PANEL_WIDTH_KEY, SIDE_PANEL_MIN, SIDE_PANEL_MAX, SIDE_PANEL_DEFAULT);
const readStoredHeight = () => readStoredSize(BOTTOM_PANEL_HEIGHT_KEY, BOTTOM_PANEL_MIN, BOTTOM_PANEL_MAX, BOTTOM_PANEL_DEFAULT);

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface FocusProps {
  /** Progress hairline under the header while running — same setting as the mosaic tiles. */
  runningIndicator?: TileRunningIndicator;
  /** Claude usage chip in the header (config `showUsageMeter`, default true). */
  showUsage?: boolean;
  /** Mosaic layout setting: 'vertical' (stacked) docks the companion shell below the conversation instead of beside it. */
  orientation?: MosaicOrientation;
  sessions: SessionInfo[];
  active: SessionInfo;
  socket: TypedSocket;
  theme: 'dark' | 'light';
  sidePanel: SidePanel;
  filter?: string;
  onSelect: (id: string) => void;
  onReorder: (newOrderedIds: string[]) => void;
  /** App-wide fallback when a session has no stored engine preference. */
  defaultTerminalEngine?: TerminalEngine;
  /** True when a session is owned by a different window (multi-window). */
  isForeign?: (id: string) => boolean;
  /** Label of the window that owns a foreign session, for the OTHERS strip badge. */
  foreignLabel?: (id: string) => string;
  onBack: () => void;
  onToggleDiff: () => void;
  onToggleExplorer: () => void;
  onToggleTerminal: () => void;
  /** Beta F6 (`betaActivityTimeline`): show the Activity button and panel. Off ⇒ nothing renders. */
  activityEnabled?: boolean;
  onToggleActivity?: () => void;
  /** Maximize the diff tool window over the shell (optionally focused on a file). */
  onExpandDiff: (file?: string) => void;
  /** Open a file in the Monaco editor at a line (cmd+click go-to-def from the diff). */
  onOpenFileInEditor: (filePath: string, lineNumber?: number) => void;
  /** Close the maximized tool window, returning to the shell. */
  onRestore: () => void;
  onClone: () => void;
  onKill: () => void;
  onRestart: () => void;
  /** Reopen the last Claude conversation; pass only when it applies (canResume). */
  onResume?: () => void;
  /** Write a diagnostics dump for this session to disk (debug action). */
  onDumpDiagnostics: () => void;
  /** Show the diagnostics dump button (gated by the developer-tools setting). */
  showDiagnostics: boolean;
  shortcuts?: ResolvedShortcuts;
  searchOpen?: boolean;
  onOpenSearch?: () => void;
  onCloseSearch?: () => void;
}

export function Focus({
  runningIndicator = 'hairline',
  showUsage = true,
  orientation = 'horizontal',
  sessions,
  active,
  socket,
  theme,
  sidePanel,
  filter,
  onSelect,
  onReorder,
  defaultTerminalEngine,
  isForeign,
  foreignLabel,
  onBack,
  onToggleDiff,
  onToggleExplorer,
  onToggleTerminal,
  activityEnabled = false,
  onToggleActivity,
  onExpandDiff,
  onOpenFileInEditor,
  onRestore,
  onClone,
  onKill,
  onRestart,
  onResume,
  onDumpDiagnostics,
  showDiagnostics,
  shortcuts,
  searchOpen,
  onOpenSearch,
  onCloseSearch,
}: FocusProps) {
  const [copied, setCopied] = useState(false);
  const sessionMenu = useSessionMenu();
  const [terminalFocused, setTerminalFocused] = useState(false);
  const [sidePanelWidth, setSidePanelWidth] = useState<number>(readStoredWidth);
  const [bottomPanelHeight, setBottomPanelHeight] = useState<number>(readStoredHeight);
  const [isResizing, setIsResizing] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const dragStateRef = useRef<{ start: number; startSize: number } | null>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const stacked = orientation === 'vertical';

  // Native terminal overlay (Phase 1, dark by default): opt in via build flag,
  // then confirm the addon actually loaded in this process before trusting it.
  // Availability is shared with Mosaic via useNativeTerminalAvailable so the
  // two surfaces cannot disagree on whether native is possible at all; the
  // per-session decision on top of that goes through resolveTerminalEngine.
  const nativeAvailable = useNativeTerminalAvailable();
  const modalOpen = useFullScreenSuppressed();
  // A partial surface (popover, launch card) hides this tile's native overlay
  // too; without the placeholder the tile would go blank.
  const overlayHidden = useOverlayHidden(active.id);
  const useNativeTerminal = resolveTerminalEngine(active.terminalEngine, defaultTerminalEngine, nativeAvailable);

  const sendInput = (data: string) => {
    socket.emit('session:input', { sessionId: active.id, data });
  };

  useEffect(() => {
    window.localStorage.setItem(SIDE_PANEL_WIDTH_KEY, String(sidePanelWidth));
  }, [sidePanelWidth]);

  useEffect(() => {
    window.localStorage.setItem(BOTTOM_PANEL_HEIGHT_KEY, String(bottomPanelHeight));
  }, [bottomPanelHeight]);

  // Drop terminal-focus when the active session changes (adjust-during-render).
  const [focusedSession, setFocusedSession] = useState(active.id);
  if (focusedSession !== active.id) {
    setFocusedSession(active.id);
    setTerminalFocused(false);
  }

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStateRef.current = stacked
      ? { start: e.clientY, startSize: bottomPanelHeight }
      : { start: e.clientX, startSize: sidePanelWidth };
    setIsResizing(true);
  }, [stacked, bottomPanelHeight, sidePanelWidth]);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      // The panel sits after the divider, so dragging toward it grows the panel.
      if (stacked) {
        const delta = drag.start - e.clientY;
        // Cap at what the window can give without squeezing the conversation,
        // so the stored height never exceeds what was actually visible.
        const avail = splitRef.current
          ? splitRef.current.clientHeight - CONVERSATION_MIN_HEIGHT
          : BOTTOM_PANEL_MAX;
        const max = Math.max(BOTTOM_PANEL_MIN, Math.min(BOTTOM_PANEL_MAX, avail));
        setBottomPanelHeight(Math.min(max, Math.max(BOTTOM_PANEL_MIN, drag.startSize + delta)));
      } else {
        const delta = drag.start - e.clientX;
        setSidePanelWidth(Math.min(SIDE_PANEL_MAX, Math.max(SIDE_PANEL_MIN, drag.startSize + delta)));
      }
    };
    const onUp = () => {
      dragStateRef.current = null;
      setIsResizing(false);
      // The terminal withheld every intermediate width (one duplicated block
      // each). Nothing else will re-measure now that the size stopped changing,
      // so ask for the one refit that reports the width the user settled on.
      setTimeout(() => window.dispatchEvent(new Event('terminal:refit')), 0);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = stacked ? 'row-resize' : 'col-resize';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = prevCursor;
    };
  }, [isResizing, stacked]);

  const panelForActive =
    sidePanel && sidePanel.sessionId === active.id && (sidePanel.kind !== 'activity' || activityEnabled)
      ? sidePanel
      : null;
  const maximized =
    panelForActive && (panelForActive.kind === 'diff' || panelForActive.kind === 'explorer') && panelForActive.maximized
      ? panelForActive
      : null;
  const dockedOpen = !!panelForActive && !maximized;

  // Restore the split and re-focus / re-fit the terminal (keeps xterm mounted while
  // maximized; the cold-remount garble is avoided — see argus-terminal-replay).
  const restoreToShell = useCallback(() => {
    onRestore();
    setFocusToken((t) => t + 1);
    // Let layout settle, then make xterm re-measure its now-visible container.
    setTimeout(() => window.dispatchEvent(new Event('terminal:refit')), 60);
  }, [onRestore]);

  const onShellClick = useCallback(() => {
    if (maximized) restoreToShell();
    else onToggleTerminal();
  }, [maximized, restoreToShell, onToggleTerminal]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <ChipStrip sessions={sessions} activeId={active.id} filter={filter} onSelect={onSelect} onReorder={onReorder} isForeign={isForeign} foreignLabel={foreignLabel} />

      <div ref={splitRef} style={{ flex: 1, display: 'flex', flexDirection: stacked ? 'column' : 'row', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: stacked ? CONVERSATION_MIN_HEIGHT : 0 }}>
          <div
            style={{
              position: 'relative', // anchors the running hairline
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--s-3)',
              height: 'var(--h-panel-header)',
              boxSizing: 'border-box',
              padding: '0 var(--s-4)',
              background: 'var(--bg-1)',
              borderBottom: '1px solid var(--line-2)',
              flexShrink: 0,
            }}
          >
            <AgentGlyph agent={active.agentType} size={16} />
            <StatusPill status={active.status} />
            {sessionMenu.isRenaming(active.id, 'focus') ? (
              <SessionRenameInput
                initial={shellLabel(active)}
                onCommit={(v) => sessionMenu.commitRename(active.id, v)}
                onCancel={sessionMenu.cancelRename}
                style={{ flex: '0 1 260px', fontSize: 'var(--t-sm)' }}
              />
            ) : (
            <Tooltip content="Click to copy path · right-click for actions">
              <span
                role="button"
                tabIndex={0}
                aria-label={copied ? 'Path copied' : `Copy path ${active.folderPath}`}
                onContextMenu={(e) => sessionMenu.openMenu(active, e, 'focus')}
                onClick={() => {
                  void navigator.clipboard.writeText(active.folderPath);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void navigator.clipboard.writeText(active.folderPath);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  }
                }}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--t-sm)',
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  color: copied ? 'var(--accent)' : 'var(--fg-0)',
                  minWidth: 0,
                }}
              >
                {copied ? 'Copied path' : shellLabel(active)}
              </span>
            </Tooltip>
            )}
            {active.runMode === 'direct' && (
              <Tooltip content="Native terminal — stops when Argus quits">
                <span className="argus-tile-branch">Native</span>
              </Tooltip>
            )}
            {active.shellGit !== undefined ? (
              active.cwd && active.shellGit && <ShellGitChip cwd={active.cwd} git={active.shellGit} />
            ) : active.hasGitChanges && <DirtyBadge onClick={() => onExpandDiff()} />}
            <StaleChip staleDays={active.worktreeStaleDays} />
            {active.pr && <PrChip pr={active.pr} />}
            {showUsage && active.usage && <UsageChip usage={active.usage} />}
            <div style={{ flex: 1 }} />
            <Button
              variant={sidePanel?.kind === 'diff' ? 'solid' : 'ghost'}
              size="sm"
              icon={GitCompare}
              onClick={onToggleDiff}
            >
              Diff
            </Button>
            <Button
              variant={sidePanel?.kind === 'explorer' ? 'solid' : 'ghost'}
              size="sm"
              icon={FolderOpen}
              onClick={onToggleExplorer}
            >
              Files
            </Button>
            {activityEnabled && onToggleActivity && (
              <Button
                variant={!maximized && panelForActive?.kind === 'activity' ? 'solid' : 'ghost'}
                size="sm"
                icon={Activity}
                onClick={onToggleActivity}
              >
                Activity
              </Button>
            )}
            <Button
              variant={!maximized && sidePanel?.kind === 'terminal' ? 'solid' : 'ghost'}
              size="sm"
              icon={Terminal}
              onClick={onShellClick}
            >
              Shell
            </Button>
            <div style={{ width: 1, height: 18, background: 'var(--line-2)', borderRadius: 1, flexShrink: 0, margin: '0 2px' }} />
            <IconButton icon={Minimize2} label="Exit focus" size="sm" onClick={onBack} />
            <IconButton icon={Copy} label="Start a new shell from the same folder" size="sm" onClick={onClone} />
            {showDiagnostics && (
              <IconButton icon={Bug} label="Dump diagnostics to ~/.argus/diagnostics" size="sm" onClick={onDumpDiagnostics} />
            )}
            <IconButton icon={RotateCcw} label="Restart shell" size="sm" onClick={onRestart} />
            <IconButton icon={CircleX} label="Close shell" size="sm" onClick={onKill} />
            {runningIndicator === 'hairline' && active.status === 'running' && (
              <span className="argus-tile-prog" aria-hidden><i /></span>
            )}
          </div>

          {/* Terminal/reply region. The terminal stays mounted at all times; when a
              tool window is maximized it collapses to 0 height and the workbench
              overlays the region, with a clickable peek strip to return. */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div style={{ flex: maximized ? '0 0 0px' : 1, minHeight: 0, display: 'flex', overflow: 'hidden', position: 'relative' }}>
              <ErrorBoundary key={active.id} label={active.name}>
                <TerminalShell
                  session={active}
                  socket={socket}
                  theme={theme}
                  status={active.status}
                  focused={terminalFocused}
                  onFocusChange={setTerminalFocused}
                  // Entering Focus is a request to work in this shell: take
                  // keyboard focus on mount (and again once a native overlay
                  // has attached). Until this was explicit, a native shell got
                  // focus only because requestFocusToken 0 was mistaken for a
                  // request; once that was corrected, Focus opened with the
                  // shell unfocused and dimmed until clicked.
                  autoFocus
                  framed={false}
                  shortcuts={shortcuts}
                  searchOpen={searchOpen}
                  onOpenSearch={onOpenSearch}
                  onCloseSearch={onCloseSearch}
                  requestFocusToken={focusToken}
                  suspendResize={isResizing}
                  useNative={useNativeTerminal}
                />
              </ErrorBoundary>
              {active.status === 'exited' && !useNativeTerminal && (
                <ExitedCard runMode={active.runMode} folderPath={active.folderPath} onRestart={onRestart} onResume={onResume} onClone={onClone} />
              )}
              {(modalOpen || overlayHidden) && <ModalPlaceholder status={active.status} />}
            </div>

            {!maximized && <ReplyBar session={active} onSend={sendInput} />}

            {maximized && (
              <>
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: PEEK_HEIGHT,
                    display: 'flex',
                    background: 'var(--bg-0)',
                    animation: 'argus-fade-in var(--dur-base) var(--ease-out)',
                  }}
                >
                  <Suspense
                    fallback={
                      <div
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--fg-2)',
                        }}
                      >
                        <Spinner size={20} />
                      </div>
                    }
                  >
                    {maximized.kind === 'diff' ? (
                      <DiffWorkbench
                        key={workRoot(active)}
                        session={active}
                        onClose={restoreToShell}
                        initialFile={maximized.file}
                        onOpenInEditor={onOpenFileInEditor}
                      />
                    ) : (
                      <ExplorerWorkbench
                        key={workRoot(active)}
                        session={active}
                        onClose={restoreToShell}
                        initialFilePath={maximized.filePath}
                        initialLine={maximized.lineNumber}
                        initialQuery={maximized.query}
                      />
                    )}
                  </Suspense>
                </div>
                <button
                  onClick={restoreToShell}
                  title="Return to shell"
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: PEEK_HEIGHT,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--s-2)',
                    padding: '0 var(--s-4)',
                    background: 'var(--bg-1)',
                    borderTop: '1px solid var(--line-2)',
                    color: 'var(--fg-3)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--t-tiny)',
                  }}
                >
                  <Terminal size={12} strokeWidth={1.6} />
                  <span>Shell · collapsed</span>
                  <div style={{ flex: 1 }} />
                  <span className="eyebrow" style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <ChevronUp size={12} strokeWidth={1.8} /> RETURN
                  </span>
                </button>
              </>
            )}
          </div>
        </div>

        {dockedOpen && (
          <ResizeDivider
            isDragging={isResizing}
            onMouseDown={onResizeStart}
            orientation={stacked ? 'horizontal' : 'vertical'}
          />
        )}
        {dockedOpen && panelForActive?.kind === 'terminal' && (
          <CompanionTerminalPanel
            session={active}
            socket={socket}
            theme={theme}
            placement={stacked ? 'bottom' : 'side'}
            size={stacked ? bottomPanelHeight : sidePanelWidth}
          />
        )}
        {dockedOpen && panelForActive?.kind === 'activity' && (
          <ActivityPanel
            session={active}
            socket={socket}
            placement={stacked ? 'bottom' : 'side'}
            size={stacked ? bottomPanelHeight : sidePanelWidth}
            onOpenFile={(filePath) => onOpenFileInEditor(filePath)}
          />
        )}
      </div>
    </div>
  );
}
