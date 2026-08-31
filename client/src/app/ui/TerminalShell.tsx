import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionInfo, SessionStatus } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import type { ISearchOptions } from '@xterm/addon-search';
import { useTerminal } from '../../hooks/useTerminal.js';
import { useNativeOverlayRect } from '../../hooks/useNativeOverlayRect.js';
import { SuppressWhileMounted } from '../../hooks/useOverlaySuppression.js';
import { STATUS_COLORS } from '../../constants/status.js';
import { formatPathsForPty } from '../../utils/pathFormat.js';
import { TerminalSearchBar } from '../../components/terminal/TerminalSearchBar.js';
import type { TerminalSearchEngine } from '../../components/terminal/TerminalSearchBar.js';
import type { ResolvedShortcuts } from '../../keyboard/useShortcuts.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Decoration colors (must be #RRGGBB). Tokens aren't usable here — xterm paints these directly.
const XTERM_SEARCH_DECORATIONS = {
  matchBackground: '#3d59a1',
  matchOverviewRuler: '#3d59a1',
  activeMatchBackground: '#e0af68',
  activeMatchColorOverviewRuler: '#e0af68',
};

/** The slice of the native-terminal preload bridge this shell drives directly
 *  (search is a plain control action on an already-attached overlay — see
 *  electron/src/main.ts's native-term:search/clear-search handlers — unlike
 *  attach/detach it needs no window-scoping). */
interface NativeSearchBridge {
  search(sessionId: string, term: string, forward: boolean): Promise<boolean>;
  clearSearch(sessionId: string): void;
}

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
  /** Increment to imperatively focus the terminal (e.g. notification click). */
  requestFocusToken?: number;
  /** True while a layout divider is being dragged — holds back pty resizes (see useTerminal). */
  suspendResize?: boolean;
  /** Render a transparent hole for a native terminal overlay instead of mounting xterm.js. Phase 1, Focus view only. */
  useNative?: boolean;
}

/**
 * Transparent "hole" a native terminal overlay window is positioned over.
 * A distinct component (not a branch inside TerminalShellXterm) so that
 * switching `useNative` unmounts/mounts cleanly instead of conditionally
 * calling useTerminal — that would leave xterm mounted underneath, or skip
 * its teardown, depending on render order.
 */
function TerminalShellNativeHole(props: TerminalShellProps) {
  const { session, searchOpen = false, onCloseSearch } = props;
  // `useNative` is a global, once-decided flag — but attach() can still fail
  // for one particular session (e.g. the addon returns without a usable
  // window). Falling back to xterm.js here, rather than leaving a permanently
  // blank transparent hole, is what makes that failure recoverable.
  const [failed, setFailed] = useState(false);
  const holeRef = useNativeOverlayRect(session.id, !failed, () => setFailed(true));
  const searchBarRef = useRef<HTMLDivElement>(null);

  // Drives the native overlay's own SwiftTerm search machinery
  // (OverlayController.search/clearSearch) through the same TerminalSearchBar
  // component the xterm path uses — the ruling behind this task is one
  // visually identical search box regardless of engine, never SwiftTerm's own
  // MacFindBarView. The native addon's search(term, forward) takes no
  // case/regex options (see task-6-brief.md's literal signature), so those
  // two toggle buttons are inert here — a known, disclosed limitation rather
  // than a different-looking control set.
  const nativeSearchEngine = useMemo<TerminalSearchEngine>(() => {
    const listeners = new Set<(r: { index: number; count: number }) => void>();
    const bridge = () =>
      (window as Window & { electronNativeTerminal?: NativeSearchBridge }).electronNativeTerminal;
    return {
      find: (term, direction) => {
        return bridge()?.search(session.id, term, direction === 'next').then((found) => {
          // The native call only reports found/not-found, not a match count —
          // `count: -1` (neither the ">0" nor the "===0" branch the bar's
          // label checks) intentionally renders no number for a genuine find,
          // rather than fabricating a "1/1" that would misstate how many
          // matches actually exist.
          const result = found ? { index: 0, count: -1 } : { index: -1, count: 0 };
          for (const cb of listeners) cb(result);
        });
      },
      clear: () => bridge()?.clearSearch(session.id),
      onResults: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
      // No native "make key" call exists (and none was added — the addon's
      // export budget for this task is exactly attach+2, see the brief). The
      // user reclaims the terminal with a click, same as any other unfocused
      // native overlay.
      focusTerminal: () => {},
    };
  }, [session.id]);

  if (failed) return <TerminalShellXterm {...props} />;
  return (
    <div ref={holeRef} style={{ flex: 1, minHeight: 0, background: 'transparent', position: 'relative' }}>
      {searchOpen && onCloseSearch && (
        <>
          <TerminalSearchBar ref={searchBarRef} engine={nativeSearchEngine} onClose={onCloseSearch} />
          {/* A child NSWindow always paints above the parent's web content
              (Gate A), so this DOM search box would render invisibly BEHIND
              the native terminal unless that overlay is hidden for as long as
              the box covers it — see useOverlaySuppression. Scoped to the
              box's own rect (not the whole tile) so only overlays it actually
              intersects are affected, matching every other floating surface
              in the app (Tooltip, ContextMenu, Sheet, ...). Trade-off: this
              also blanks the terminal content behind the box for the
              search's duration, unlike the xterm path where highlights stay
              visible — accepted here rather than building bespoke partial
              native-window clipping for a find bar. */}
          <SuppressWhileMounted target={() => searchBarRef.current?.getBoundingClientRect() ?? null} />
        </>
      )}
    </div>
  );
}

/**
 * xterm.js container. Interior is fully owned by useTerminal — this wrapper
 * supplies the status-colored frame only. Refit via 'terminal:refit' window event.
 */
function TerminalShellXterm({ session, socket, theme, status, focused, onFocusChange, framed = true, autoFocus = false, shortcuts, searchOpen = false, onOpenSearch, onCloseSearch, requestFocusToken, suspendResize = false }: TerminalShellProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const { terminalRef, searchAddonRef } = useTerminal(containerRef, { sessionId: session.id, socket, theme, onFocusChange, autoFocus, shortcuts, onRequestSearch: onOpenSearch, requestFocusToken, suspendResize });

  // Backs the shared TerminalSearchBar with xterm's own SearchAddon +
  // decorations. Built on stable refs (identity never changes across
  // renders), so this object stays referentially stable too — the bar's
  // onResults effect only re-subscribes when the engine identity changes.
  const xtermSearchEngine = useMemo<TerminalSearchEngine>(() => ({
    find: (term, direction, options) => {
      const addon = searchAddonRef.current;
      if (!addon) return undefined;
      const opts: ISearchOptions = { caseSensitive: options.caseSensitive, regex: options.regex, decorations: XTERM_SEARCH_DECORATIONS };
      if (direction === 'next') addon.findNext(term, { ...opts, incremental: true });
      else addon.findPrevious(term, opts);
      return undefined;
    },
    clear: () => searchAddonRef.current?.clearDecorations(),
    onResults: (cb) => {
      const addon = searchAddonRef.current;
      if (!addon) return () => {};
      const sub = addon.onDidChangeResults((r) => cb({ index: r.resultIndex, count: r.resultCount }));
      return () => sub.dispose();
    },
    focusTerminal: () => terminalRef.current?.focus(),
  }), [searchAddonRef, terminalRef]);

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
        padding: '8px 14px 0px 14px',
        position: 'relative',
        transition: 'border-color var(--dur-fast), box-shadow var(--dur-fast)',
      }}
    >
      {searchOpen && onCloseSearch && (
        <TerminalSearchBar engine={xtermSearchEngine} onClose={onCloseSearch} />
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

/**
 * Routes between the native hole and the xterm.js shell. `useNative` is
 * expected to be stable for a given session (decided once, from a build
 * flag + an availability check) — routing via component type, rather than
 * an early return inside a single component, means a flip still tears down
 * the previous path's hooks/effects correctly instead of calling useTerminal
 * conditionally.
 */
function TerminalShellRouter(props: TerminalShellProps) {
  if (props.useNative) {
    return <TerminalShellNativeHole {...props} />;
  }
  return <TerminalShellXterm {...props} />;
}

// Memoized: the mosaic parent re-renders on every focus/animation state change,
// but TerminalShell only needs to re-render when its own props change. Props
// passed in (onFocusChange, onOpenSearch, onCloseSearch) are stabilized upstream.
export const TerminalShell = memo(TerminalShellRouter);
