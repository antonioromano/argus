import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionInfo, SessionStatus } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { useTerminal } from '../../hooks/useTerminal.js';
import { STATUS_COLORS } from '../../constants/status.js';
import { formatPathsForPty } from '../../utils/pathFormat.js';
import { TerminalSearchBar } from '../../components/terminal/TerminalSearchBar.js';
import type { ResolvedShortcuts } from '../../keyboard/useShortcuts.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface TerminalShellProps {
  session: SessionInfo;
  socket: TypedSocket;
  theme: 'dark' | 'light';
  status?: SessionStatus;
  focused?: boolean;
  onFocusChange?: (focused: boolean) => void;
  /** Draw status-colored border + radius + waiting glow. Default true (mosaic). Focus view sets false. */
  framed?: boolean;
  /** Focus the terminal once it mounts (tile restored from the minimized row). */
  autoFocus?: boolean;
  /** Resolved keyboard shortcuts (for Cmd+F / Cmd+L / Shift+Enter in the terminal). */
  shortcuts?: ResolvedShortcuts;
  /** Whether the in-terminal search bar is open for this shell. */
  searchOpen?: boolean;
  /** Open this shell's search bar (Cmd+F when this terminal is focused). */
  onOpenSearch?: () => void;
  /** Close this shell's search bar. */
  onCloseSearch?: () => void;
}

/**
 * xterm.js container. Interior is fully owned by useTerminal — this wrapper
 * supplies the status-colored frame only. Refit via 'terminal:refit' window event.
 */
export function TerminalShell({ session, socket, theme, status, focused, onFocusChange, framed = true, autoFocus = false, shortcuts, searchOpen = false, onOpenSearch, onCloseSearch }: TerminalShellProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const { terminalRef, searchAddonRef } = useTerminal(containerRef, { sessionId: session.id, socket, theme, onFocusChange, autoFocus, shortcuts, onRequestSearch: onOpenSearch });

  // Refit on focus enter so xterm cols/rows match
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('terminal:refit')), 50);
    return () => clearTimeout(t);
  }, [session.id]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const types = Array.from(e.dataTransfer.types);
    if (types.includes('application/x-argus-path') || types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const paths: string[] = [];

    const argusPath = e.dataTransfer.getData('application/x-argus-path');
    if (argusPath) {
      paths.push(argusPath);
    } else if (e.dataTransfer.files.length > 0) {
      const electronFiles = (window as Window & { electronFiles?: { getPath: (n: string) => string | undefined } }).electronFiles;
      for (const file of Array.from(e.dataTransfer.files)) {
        const fullPath = electronFiles?.getPath(file.name)
          ?? (file as File & { path?: string }).path
          ?? file.name;
        paths.push(fullPath);
      }
    } else {
      const text = e.dataTransfer.getData('text/plain');
      if (text) paths.push(text);
    }

    const data = formatPathsForPty(paths);
    if (data) {
      socket.emit('session:input', { sessionId: session.id, data });
    }
  }, [socket, session.id]);

  const st = status ?? session.status;
  const edge = STATUS_COLORS[st];
  // Match xterm's own theme background so the sub-row gutter left by FitAddon's
  // whole-cell rounding (most visible at the bottom) blends in instead of
  // showing as a dark band.
  const termBg = theme === 'dark' ? '#1a1b26' : '#f5f5f5';

  return (
    <div
      ref={containerRef}
      className="terminal-panel"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        flex: 1,
        minHeight: 0,
        background: termBg,
        border: framed ? `1px solid ${isDragOver ? 'var(--accent)' : edge}` : (isDragOver ? '1px solid var(--accent)' : 'none'),
        borderRadius: framed ? 'var(--r-2)' : 0,
        overflow: 'hidden',
        boxShadow: isDragOver
          ? `0 0 0 1px var(--accent), 0 0 18px var(--accent-glow)`
          : (framed && st === 'waiting' ? `0 0 0 1px ${edge}, 0 0 18px var(--accent-glow)` : 'none'),
        padding: '6px 2px 2px 6px',
        position: 'relative',
        transition: 'border-color var(--dur-fast), box-shadow var(--dur-fast)',
      }}
    >
      {searchOpen && onCloseSearch && (
        <TerminalSearchBar searchAddonRef={searchAddonRef} terminalRef={terminalRef} onClose={onCloseSearch} />
      )}
      {focused === false && <div className="argus-tile-overlay" style={{ borderRadius: framed ? 'var(--r-2)' : 0 }} />}
      {isDragOver && (
        <div
          aria-hidden
          className="argus-drop-overlay"
          style={{ borderRadius: framed ? 'var(--r-2)' : 0 }}
        >
          <div className="argus-drop-pill">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 3v13" />
              <path d="M6 11l6 6 6-6" />
              <path d="M5 21h14" />
            </svg>
            <span>Drop to paste path</span>
          </div>
        </div>
      )}
    </div>
  );
}
