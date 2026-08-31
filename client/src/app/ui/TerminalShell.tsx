import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionInfo, SessionStatus } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import type { ISearchOptions } from '@xterm/addon-search';
import { useTerminal } from '../../hooks/useTerminal.js';
import { useNativeOverlayRect } from '../../hooks/useNativeOverlayRect.js';
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
 *  to CLOSE SwiftTerm's OWN find bar (a plain control action on an
 *  already-attached overlay — see electron/src/main.ts's
 *  native-term:close-find-bar handler — unlike attach/detach it needs no
 *  window-scoping). Opening deliberately does NOT go through this component
 *  — see the doc comment on the effect below and on
 *  useTerminal.ts's openNativeFindBar. */
interface NativeFindBarCloseBridge {
  closeFindBar(sessionId: string): void;
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
  const { session, searchOpen = false } = props;
  // `useNative` is a global, once-decided flag — but attach() can still fail
  // for one particular session (e.g. the addon returns without a usable
  // window). Falling back to xterm.js here, rather than leaving a permanently
  // blank transparent hole, is what makes that failure recoverable.
  const [failed, setFailed] = useState(false);
  const holeRef = useNativeOverlayRect(session.id, !failed, () => setFailed(true));

  // mod+f for a native tile toggles SwiftTerm's OWN find bar
  // (TerminalFindBarView, embedded as a subview of the SAME NSWindow the
  // terminal renders in — see OverlayController.openFindBar/closeFindBar)
  // rather than Argus's DOM TerminalSearchBar. Reversed from this task's
  // original ruling: a child NSWindow always paints above the parent's web
  // content (Phase 2 Gate A), so a DOM search box over a native tile can
  // only ever render invisibly behind it, or force hiding the ENTIRE tile
  // for the search's duration (the earlier approach, via
  // useOverlaySuppression — reverted here). SwiftTerm's own bar sidesteps
  // the z-order problem by living inside the window that's already on top:
  // no suppression, no reflow, matches stay visible. Disclosed trade-off:
  // its box looks different from the xterm path's TerminalSearchBar (no
  // shared visual chrome between engines for search specifically).
  //
  // OPENING deliberately does NOT live here. An earlier version of this
  // effect called `bridge.openFindBar` on `searchOpen` flipping true — but
  // SwiftTerm's find bar can be dismissed from INSIDE its own window (its
  // own Escape/close button) with no callback back to JS, so `searchOpen`
  // (React state) can go stale: it stays `true` even after the native bar
  // has actually closed. Gating the open call on that prop's dependency
  // array meant a second Cmd+F on the SAME tile — the very next thing a user
  // does after Escaping out of the bar — was silently swallowed, since the
  // prop never changed and the effect never re-ran. ArgusApp.tsx's search
  // action (openTerminalSearch/openTerminalSearchFor) now calls
  // useTerminal.ts's openNativeFindBar directly and unconditionally on every
  // invocation instead, so a repeat request always reaches the native side
  // regardless of what this prop currently says.
  //
  // CLOSING stays here, keyed on `searchOpen` — that direction has no
  // equivalent staleness problem: `searchOpen` going false is always a real,
  // JS-driven transition (an explicit close, or a different session becoming
  // the search target), and it's also the only path that clears the search
  // highlight — an Escape typed directly into the native bar hides it via
  // SwiftTerm's own (unexported) path, which does not clear the highlight.
  useEffect(() => {
    if (searchOpen) return;
    (window as Window & { electronNativeTerminal?: NativeFindBarCloseBridge })
      .electronNativeTerminal?.closeFindBar(session.id);
  }, [searchOpen, session.id]);

  // Unmounting the tile (session closed, engine switched) must not leave a
  // find bar open on an overlay id that could be reused later.
  useEffect(() => {
    return () => {
      (window as Window & { electronNativeTerminal?: NativeFindBarCloseBridge })
        .electronNativeTerminal?.closeFindBar(session.id);
    };
  }, [session.id]);

  if (failed) return <TerminalShellXterm {...props} />;
  return (
    <div ref={holeRef} style={{ flex: 1, minHeight: 0, background: 'transparent', position: 'relative' }} />
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
