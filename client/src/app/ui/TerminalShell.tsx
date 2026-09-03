import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionInfo, SessionStatus } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import type { ISearchOptions } from '@xterm/addon-search';
import { useTerminal, nativeThemeFor } from '../../hooks/useTerminal.js';
import type { NativeTerminalTheme } from '../../hooks/useTerminal.js';
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

/** The slice of the native-terminal preload bridge this shell drives to keep
 *  a native overlay's colors in sync with Argus's own terminal theme. */
interface NativeThemeBridge {
  setTheme(sessionId: string, theme: NativeTerminalTheme): void;
}

/** The slice of the native-terminal preload bridge that paints the
 *  unfocused-tile scrim inside the overlay's own window. */
/** The slice of the native-terminal preload bridge that gives an overlay
 *  keyboard focus — the native answer to focusing xterm's textarea. */
interface NativeFocusRequestBridge {
  focusTerminal?(sessionId: string): void;
}

interface NativeDimBridge {
  setDimmed?(sessionId: string, dimmed: boolean, isDark: boolean): void;
}

/** The slice of the native-terminal preload bridge that reports key-window
 *  transitions on overlays. Optional at the call site: an older preload (or a
 *  non-Electron client) simply never reports, and the tile stays unfocused
 *  rather than throwing. */
interface NativeFocusBridge {
  onFocus?(cb: (sessionId: string, focused: boolean) => void): () => void;
}

/** The slice of the native-terminal preload bridge that reports files dropped
 *  onto an overlay. The overlay is an opaque child window, so React's own
 *  onDrop on the hole never sees the drop — AppKit does, and forwards the raw
 *  paths here. Formatting stays in formatPathsForPty so both engines quote
 *  identically. */
interface NativeDropBridge {
  onDropPaths?(cb: (sessionId: string, paths: string[]) => void): () => void;
}

/** The slice of the native-terminal preload bridge that reports the terminal
 *  bell, so a native tile can flash like an xterm one. */
interface NativeBellBridge {
  onBell?(cb: (sessionId: string) => void): () => void;
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
  /**
   * Whether the tile is currently dimmed by `.argus-tile-overlay`.
   *
   * A native overlay is a child NSWindow: the DOM scrim renders behind it and
   * cannot dim it, so it paints an equivalent scrim inside its own window and
   * needs to know exactly when. It cannot infer it — `focused` is the
   * TERMINAL's focus, while the tile dims on `!isFocused || !windowFocused`,
   * so the whole app losing focus dimmed every tile and left the overlay
   * bright. Mosaic passes its own condition; callers that never dim omit it.
   */
  dimmed?: boolean;
}

/**
 * Transparent "hole" a native terminal overlay window is positioned over.
 * A distinct component (not a branch inside TerminalShellXterm) so that
 * switching `useNative` unmounts/mounts cleanly instead of conditionally
 * calling useTerminal — that would leave xterm mounted underneath, or skip
 * its teardown, depending on render order.
 */
function TerminalShellNativeHole(props: TerminalShellProps) {
  const { session, theme, searchOpen = false, focused, dimmed, autoFocus = false, requestFocusToken } = props;
  // `useNative` is a global, once-decided flag — but attach() can still fail
  // for one particular session (e.g. the addon returns without a usable
  // window). Falling back to xterm.js here, rather than leaving a permanently
  // blank transparent hole, is what makes that failure recoverable.
  const [failed, setFailed] = useState(false);
  // Bumped by useNativeOverlayRect's onAttached once a real overlay exists,
  // so the theme effect below re-fires and paints it — see that effect's
  // doc comment for why attach alone isn't already covered by the [theme]
  // dependency.
  const [attachGeneration, setAttachGeneration] = useState(0);
  const holeRef = useNativeOverlayRect(session.id, !failed, () => setFailed(true), () => setAttachGeneration((n) => n + 1));

  // Applies Argus's terminal theme (the SAME colors useTerminal.ts's xterm.js
  // path uses — see nativeThemeFor) to the native overlay.
  //
  // Runs on two triggers: `theme` changing (the app's light/dark toggle must
  // repaint an ALREADY-live overlay, not just a newly attached one) and
  // `attachGeneration` bumping (attach() is async — this effect can run, and
  // no-op via NativeTerminalHost.setTheme's own guard, before an overlay
  // exists at all; the bump re-fires it once one does, so a fresh SwiftTerm
  // view is never left painted in SwiftTerm's own black-background defaults).
  //
  // Keying on the value is correct now that the switch is instant everywhere
  // (see ThemeContext). It was not while the app crossfaded: the value changes
  // before a view transition starts animating, so the overlay — which cannot
  // join that transition — ran ahead of it.
  useEffect(() => {
    (window as Window & { electronNativeTerminal?: NativeThemeBridge })
      .electronNativeTerminal?.setTheme(session.id, nativeThemeFor(theme));
  }, [session.id, theme, attachGeneration]);

  // `dimmed` when the caller tracks it (Mosaic), otherwise fall back to the
  // terminal's own focus — which is all the Focus view has.
  const isDimmed = dimmed ?? focused === false;

  // The xterm path dims an unfocused tile with a DOM element inside its own
  // container (`.argus-tile-overlay`). A native tile cannot: a child NSWindow
  // paints above the web contents, so that element would be invisible. Drive
  // the equivalent scrim inside the overlay's window instead, from the same
  // `focused === false` condition, so the two engines agree about what an
  // unfocused tile looks like. Re-runs on attachGeneration for the same reason
  // the theme effect does — attach is async, so a scrim applied before the
  // overlay exists would be lost.
  useEffect(() => {
    (window as Window & { electronNativeTerminal?: NativeDimBridge })
      .electronNativeTerminal?.setDimmed?.(session.id, isDimmed, theme === 'dark');
  }, [session.id, isDimmed, theme, attachGeneration]);

  // Keyboard focus on request — the native counterpart of useTerminal's
  // autoFocus and requestFocusToken, which only ever reached xterm. A
  // notification click and restoring a minimized tile both go through these,
  // and for a native tile both silently did nothing: the tile came forward
  // with the cursor still wherever it was.
  //
  // attachGeneration is a dependency for the same reason the theme effect
  // needs it — on first mount this can run before the overlay exists, and the
  // bump re-fires it once it does, which is what makes autoFocus work at all.
  useEffect(() => {
    if (!autoFocus && requestFocusToken === undefined) return;
    (window as Window & { electronNativeTerminal?: NativeFocusRequestBridge })
      .electronNativeTerminal?.focusTerminal?.(session.id);
  }, [session.id, autoFocus, requestFocusToken, attachGeneration]);

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

  // Clicking a native tile puts the click into the child NSWindow — the web
  // contents never sees it, so the DOM focus/blur events the xterm.js path
  // relies on simply never fire here. Without this bridge a native tile can
  // never become the app's focused tile, which silently breaks every command
  // that acts on "the focused shell": Cmd+T (open shell), Cmd+D (diff),
  // Cmd+E (files), Cmd+L (clear), Cmd+F (search), plus the tile's own focus
  // ring and the unfocused dim.
  //
  // Mirrored into a ref for the same reason as onFailure/onAttached above:
  // callers build `onFocusChange` inline, so depending on it directly would
  // resubscribe on every render.
  const onFocusChangeRef = useRef(props.onFocusChange);
  useEffect(() => {
    onFocusChangeRef.current = props.onFocusChange;
  });
  useEffect(() => {
    const bridge = (window as Window & { electronNativeTerminal?: NativeFocusBridge })
      .electronNativeTerminal;
    if (!bridge?.onFocus) return;
    return bridge.onFocus((id, isFocused) => {
      if (id !== session.id) return;
      onFocusChangeRef.current?.(isFocused);
    });
  }, [session.id]);

  // Visual bell. Flashes the same class the xterm path uses; on both engines
  // the terminal itself paints over the middle, so what actually shows is the
  // gutter inside the frame.
  const frameRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const bridge = (window as Window & { electronNativeTerminal?: NativeBellBridge })
      .electronNativeTerminal;
    if (!bridge?.onBell) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = bridge.onBell((id) => {
      if (id !== session.id) return;
      const el = frameRef.current;
      if (!el) return;
      el.classList.remove('terminal-bell-flash');
      // Force reflow to retrigger the animation.
      void el.offsetWidth;
      el.classList.add('terminal-bell-flash');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove('terminal-bell-flash'), 200);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe?.();
    };
  }, [session.id]);

  // Files dropped onto the overlay. Same destination as the xterm path's
  // handleDrop: formatPathsForPty then session:input.
  useEffect(() => {
    const bridge = (window as Window & { electronNativeTerminal?: NativeDropBridge })
      .electronNativeTerminal;
    if (!bridge?.onDropPaths) return;
    return bridge.onDropPaths((id, paths) => {
      if (id !== session.id) return;
      const data = formatPathsForPty(paths);
      if (data) props.socket.emit('session:input', { sessionId: session.id, data });
    });
    // props.socket is the singleton WS client; reading it off props here keeps
    // this effect out of the render-time destructuring above.
  }, [session.id, props.socket]);

  if (failed) return <TerminalShellXterm {...props} />;
  const { status, framed = true } = props;
  const st = status ?? session.status;
  const edge = STATUS_COLORS[st];
  // The overlay is an opaque child NSWindow covering exactly the hole, so any
  // chrome has to live OUTSIDE that rect to be visible at all. Border, radius
  // and the waiting glow sit on this wrapper and survive; the hole is inset by
  // the same padding the xterm path uses, which is what leaves room for them.
  // (The unfocused dim and drag-over overlays that the xterm path draws INSIDE
  // its container have no native equivalent — they would render behind the
  // overlay — so they are deliberately not reproduced here.)
  return (
    <div
      ref={frameRef}
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        background: 'transparent',
        border: framed ? `1px solid ${edge}` : 'none',
        borderRadius: framed ? 'var(--r-2)' : 0,
        boxShadow: framed && st === 'waiting'
          ? `0 0 0 1px ${edge}, 0 0 18px var(--accent-glow)`
          : 'none',
        // Bottom padding is deliberately NOT the xterm path's 0. The overlay is
        // a rectangular window with square corners that the frame's 4px
        // border-radius cannot clip, so without an inset it sits on the bottom
        // border and pokes into the rounded corners. 8px matches the top and
        // keeps the overlay clear of both.
        padding: '8px 14px 8px 14px',
        overflow: 'hidden',
        position: 'relative',
        transition: 'border-color var(--dur-fast), box-shadow var(--dur-fast)',
      }}
    >
      <div ref={holeRef} style={{ flex: 1, minHeight: 0, background: 'transparent', position: 'relative' }} />
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
  // showing as a dark band. Same values as DARK_THEME/LIGHT_THEME in
  // useTerminal.ts, which are themselves --bg-2 — the tile card the terminal
  // sits in.
  const termBg = theme === 'dark' ? '#191b20' : '#ffffff';

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
