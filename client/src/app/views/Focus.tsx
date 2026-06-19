import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { Terminal, Copy, GitCompare, FolderOpen, Minimize2, CircleX, RotateCcw, ChevronUp } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { ChipStrip } from '../ui/ChipStrip.js';
import { ReplyBar } from '../ui/ReplyBar.js';
import { TerminalShell } from '../ui/TerminalShell.js';
import { StatusPill, DirtyBadge, Button, IconButton, Tooltip } from '../../components/primitives/index.js';
import { shellLabel } from '../../utils/sessionLabel.js';
import { CompanionTerminalPanel } from '../panels/CompanionTerminalPanel.js';
import { DiffWorkbench } from '../panels/DiffWorkbench.js';
import { ExplorerWorkbench } from '../panels/ExplorerWorkbench.js';
import { ResizeDivider } from '../../components/ResizeDivider.js';
import { ErrorBoundary } from '../../components/ErrorBoundary.js';
import type { SidePanel } from '../types.js';
import type { ResolvedShortcuts } from '../../keyboard/useShortcuts.js';

const SIDE_PANEL_WIDTH_KEY = 'argus.focus.sidePanelWidth';
const SIDE_PANEL_MIN = 240;
const SIDE_PANEL_MAX = 720;
const SIDE_PANEL_DEFAULT = 320;
const PEEK_HEIGHT = 34;

function readStoredWidth(): number {
  if (typeof window === 'undefined') return SIDE_PANEL_DEFAULT;
  const raw = window.localStorage.getItem(SIDE_PANEL_WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return SIDE_PANEL_DEFAULT;
  return Math.min(SIDE_PANEL_MAX, Math.max(SIDE_PANEL_MIN, n));
}

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface FocusProps {
  sessions: SessionInfo[];
  active: SessionInfo;
  socket: TypedSocket;
  theme: 'dark' | 'light';
  sidePanel: SidePanel;
  filter?: string;
  onSelect: (id: string) => void;
  onReorder: (newOrderedIds: string[]) => void;
  onBack: () => void;
  onToggleDiff: () => void;
  onToggleExplorer: () => void;
  onToggleTerminal: () => void;
  /** Maximize the diff tool window over the shell (optionally focused on a file). */
  onExpandDiff: (file?: string) => void;
  /** Close the maximized tool window, returning to the shell. */
  onRestore: () => void;
  onClone: () => void;
  onKill: () => void;
  onRestart: () => void;
  shortcuts?: ResolvedShortcuts;
  searchOpen?: boolean;
  onOpenSearch?: () => void;
  onCloseSearch?: () => void;
}

export function Focus({
  sessions,
  active,
  socket,
  theme,
  sidePanel,
  filter,
  onSelect,
  onReorder,
  onBack,
  onToggleDiff,
  onToggleExplorer,
  onToggleTerminal,
  onExpandDiff,
  onRestore,
  onClone,
  onKill,
  onRestart,
  shortcuts,
  searchOpen,
  onOpenSearch,
  onCloseSearch,
}: FocusProps) {
  const [copied, setCopied] = useState(false);
  const [terminalFocused, setTerminalFocused] = useState(false);
  const [sidePanelWidth, setSidePanelWidth] = useState<number>(readStoredWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const sendInput = (data: string) => {
    socket.emit('session:input', { sessionId: active.id, data });
  };

  useEffect(() => {
    window.localStorage.setItem(SIDE_PANEL_WIDTH_KEY, String(sidePanelWidth));
  }, [sidePanelWidth]);

  // Drop terminal-focus when the active session changes (adjust-during-render).
  const [focusedSession, setFocusedSession] = useState(active.id);
  if (focusedSession !== active.id) {
    setFocusedSession(active.id);
    setTerminalFocused(false);
  }

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStateRef.current = { startX: e.clientX, startWidth: sidePanelWidth };
    setIsResizing(true);
  }, [sidePanelWidth]);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const delta = drag.startX - e.clientX;
      const next = Math.min(SIDE_PANEL_MAX, Math.max(SIDE_PANEL_MIN, drag.startWidth + delta));
      setSidePanelWidth(next);
    };
    const onUp = () => {
      dragStateRef.current = null;
      setIsResizing(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = prevCursor;
    };
  }, [isResizing]);

  const panelForActive =
    sidePanel && sidePanel.sessionId === active.id ? sidePanel : null;
  const maximized =
    panelForActive && panelForActive.kind !== 'terminal' && panelForActive.maximized
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
      <ChipStrip sessions={sessions} activeId={active.id} filter={filter} onSelect={onSelect} onReorder={onReorder} />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--s-3)',
              padding: 'var(--s-1) var(--s-4)',
              background: 'var(--bg-1)',
              borderBottom: '1px solid var(--line-2)',
              flexShrink: 0,
            }}
          >
            <AgentGlyph agent={active.agentType} size={16} />
            <StatusPill status={active.status} />
            <Tooltip content="Click to copy path">
              <span
                role="button"
                tabIndex={0}
                aria-label={copied ? 'Path copied' : `Copy path ${active.folderPath}`}
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
            {active.hasGitChanges && <DirtyBadge onClick={() => onExpandDiff()} />}
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
            <IconButton icon={RotateCcw} label="Restart shell" size="sm" onClick={onRestart} />
            <IconButton icon={CircleX} label="Close shell" size="sm" onClick={onKill} />
          </div>

          {/* Terminal/reply region. The terminal stays mounted at all times; when a
              tool window is maximized it collapses to 0 height and the workbench
              overlays the region, with a clickable peek strip to return. */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div style={{ flex: maximized ? '0 0 0px' : 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
              <ErrorBoundary key={active.id} label={active.name}>
                <TerminalShell
                  session={active}
                  socket={socket}
                  theme={theme}
                  status={active.status}
                  focused={terminalFocused}
                  onFocusChange={setTerminalFocused}
                  framed={false}
                  shortcuts={shortcuts}
                  searchOpen={searchOpen}
                  onOpenSearch={onOpenSearch}
                  onCloseSearch={onCloseSearch}
                  requestFocusToken={focusToken}
                />
              </ErrorBoundary>
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
                  {maximized.kind === 'diff' ? (
                    <DiffWorkbench
                      session={active}
                      onClose={restoreToShell}
                      initialFile={maximized.file}
                    />
                  ) : (
                    <ExplorerWorkbench
                      session={active}
                      onClose={restoreToShell}
                      initialFilePath={maximized.filePath}
                      initialLine={maximized.lineNumber}
                      initialQuery={maximized.query}
                    />
                  )}
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

        {dockedOpen && <ResizeDivider isDragging={isResizing} onMouseDown={onResizeStart} />}
        {dockedOpen && panelForActive?.kind === 'terminal' && (
          <CompanionTerminalPanel
            session={active}
            socket={socket}
            theme={theme}
            width={sidePanelWidth}
          />
        )}
      </div>
    </div>
  );
}
