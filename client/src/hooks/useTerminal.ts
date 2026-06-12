import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, SessionStatus } from '@argus/shared';
import { comboMatches } from '../keyboard/combo.js';
import { resolveShortcuts, type ResolvedShortcuts } from '../keyboard/useShortcuts.js';
import { installSelectableMouse } from './terminalMouse.js';
import { openExternal } from '../utils/openExternal.js';

import '@xterm/xterm/css/xterm.css';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface UseTerminalOptions {
  sessionId: string;
  socket: TypedSocket;
  theme: 'dark' | 'light';
  /** Display-only: no stdin, no keyboard capture (mobile feeds input via the on-screen keyboard). */
  readOnly?: boolean;
  /** Called when xterm gains or loses keyboard focus. */
  onFocusChange?: (focused: boolean) => void;
  /** Focus the terminal once it mounts (e.g. a tile restored from the minimized row). */
  autoFocus?: boolean;
  /** Resolved keyboard shortcuts. Falls back to registry defaults when omitted. */
  shortcuts?: ResolvedShortcuts;
  /** Open the in-terminal search bar for this terminal (Cmd+F). */
  onRequestSearch?: () => void;
  /** Increment to imperatively focus the terminal (e.g. notification click). */
  requestFocusToken?: number;
}

const DARK_THEME = {
  background: '#1a1b26',
  foreground: '#c0caf5',
  cursor: '#c0caf5',
  selectionBackground: '#33467c',
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5',
};

const LIGHT_THEME = {
  background: '#f5f5f5',
  foreground: '#343b58',
  cursor: '#343b58',
  selectionBackground: '#b4d5fe',
  black: '#0f0f14',
  red: '#8c4351',
  green: '#485e30',
  yellow: '#8f5e15',
  blue: '#34548a',
  magenta: '#5a4a78',
  cyan: '#0f4b6e',
  white: '#343b58',
  brightBlack: '#9699a3',
  brightRed: '#8c4351',
  brightGreen: '#485e30',
  brightYellow: '#8f5e15',
  brightBlue: '#34548a',
  brightMagenta: '#5a4a78',
  brightCyan: '#0f4b6e',
  brightWhite: '#343b58',
};

export function useTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: UseTerminalOptions,
) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const { sessionId, socket, theme, readOnly = false, onFocusChange, autoFocus = false, shortcuts, onRequestSearch, requestFocusToken } = options;
  const themeRef = useRef(theme);
  useEffect(() => { themeRef.current = theme; }, [theme]);
  const autoFocusRef = useRef(autoFocus);
  useEffect(() => { autoFocusRef.current = autoFocus; }, [autoFocus]);
  const onFocusChangeRef = useRef(onFocusChange);
  useEffect(() => { onFocusChangeRef.current = onFocusChange; }, [onFocusChange]);
  // Key handling reads these through refs so the once-attached handler always sees
  // current bindings without re-running the terminal-creation effect.
  const shortcutsRef = useRef<ResolvedShortcuts>(shortcuts ?? resolveShortcuts());
  useEffect(() => { shortcutsRef.current = shortcuts ?? resolveShortcuts(); }, [shortcuts]);
  const onRequestSearchRef = useRef(onRequestSearch);
  useEffect(() => { onRequestSearchRef.current = onRequestSearch; }, [onRequestSearch]);

  // Insurance for cold starts: if the bundled web fonts aren't loaded when the
  // terminal is first opened, char-cell geometry can be measured against the
  // fallback font. The DOM renderer reflows on font load on its own, but we also
  // rebuild the terminal once fonts are ready so the measured metrics are correct.
  // Already-loaded (warm) → starts true → no rebuild, no flicker.
  const [fontsReady, setFontsReady] = useState(
    () => typeof document === 'undefined' || document.fonts?.status === 'loaded',
  );
  useEffect(() => {
    if (fontsReady || !document.fonts?.ready) return;
    let cancelled = false;
    document.fonts.ready.then(() => { if (!cancelled) setFontsReady(true); });
    return () => { cancelled = true; };
  }, [fontsReady]);

  // Create terminal and wire up socket
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      cursorBlink: !readOnly,
      disableStdin: readOnly,
      fontSize: 13,
      fontFamily: '"SF Mono", ui-monospace, Menlo, Monaco, "Cascadia Code", monospace',
      theme: themeRef.current === 'dark' ? DARK_THEME : LIGHT_THEME,
      allowProposedApi: true,
      scrollback: 5000,
      scrollSensitivity: 3,
      fastScrollSensitivity: 10,
      // Option composes special chars (@ [ ] { } on non-US Mac layouts) instead of
      // sending Meta. Esc still works; rarely-used Alt+ shortcuts are the tradeoff.
      macOptionIsMeta: false,
      // OSC 8 escape-sequence hyperlinks (the PR link `gh`/Claude Code emit) are
      // handled by xterm core, NOT WebLinksAddon. Without this, core shows a
      // "could be dangerous" confirm whose OK doesn't reliably open under Electron.
      // Route them to the system browser like plain-text links.
      linkHandler: { activate: (_event, uri) => openExternal(uri) },
    });

    // Visual bell — xterm v5 removed bellStyle, so wire it manually via onBell.
    let bellTimer: ReturnType<typeof setTimeout> | null = null;
    terminal.onBell(() => {
      const el = container as HTMLElement;
      el.classList.remove('terminal-bell-flash');
      // Force reflow to retrigger the animation.
      void el.offsetWidth;
      el.classList.add('terminal-bell-flash');
      if (bellTimer) clearTimeout(bellTimer);
      bellTimer = window.setTimeout(() => el.classList.remove('terminal-bell-flash'), 200);
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon((_event, uri) => openExternal(uri)));
    const searchAddon = new SearchAddon();
    terminal.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;

    terminal.open(container);

    // Read-only (mobile): xterm still creates a hidden .xterm-helper-textarea for
    // focus/a11y. Tapping it would raise the iOS soft keyboard even though stdin is
    // disabled (dead keyboard). Neuter it so taps fall through to scroll/click
    // forwarding (those listen on the container, not the textarea).
    if (readOnly) {
      const helper = container.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
      if (helper) {
        helper.readOnly = true;
        helper.inputMode = 'none';
        helper.tabIndex = -1;
        helper.setAttribute('aria-hidden', 'true');
      }
    }

    // Keep xterm out of mouse-reporting mode (plain drag selects text) while
    // forwarding wheel/touch + single clicks/taps to the inner app (scroll / click
    // claude). Always defined — even readOnly (mobile) forwards touch scroll + taps;
    // keyboard stdin stays disabled via the readOnly-gated onData below.
    const sendInput = (data: string) => socket.emit('session:input', { sessionId, data });
    const disposeMouse = installSelectableMouse(terminal, container, sessionId, sendInput);

    const xtermTextarea = container.querySelector<HTMLTextAreaElement>('textarea');
    const onXtermFocus = () => onFocusChangeRef.current?.(true);
    const onXtermBlur  = () => onFocusChangeRef.current?.(false);
    xtermTextarea?.addEventListener('focus', onXtermFocus);
    xtermTextarea?.addEventListener('blur', onXtermBlur);

    // Renderer: xterm's built-in DOM renderer (no WebGL/Canvas addon). GPU-atlas
    // renderers (WebGL, Canvas) bake a glyph atlas + char-cell metrics at init and,
    // on a fresh Electron renderer (cold fonts / unsettled DPR), bake them wrong and
    // garble until a full reload. The DOM renderer draws native text that reflows
    // automatically when fonts load — immune to that whole class (the clean v0.15.1
    // behavior, before WebGL was added in 0.16.0).

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Hide the live cursor while scrolled up the scrollback. The DOM renderer
    // paints the blinking cursor at its active buffer line; scrolling up makes
    // that block ride along over old rows (the WebGL renderer hid it off-bottom;
    // the DOM renderer does not). Toggle a class — CSS suppresses the block fill
    // with no reflow. `viewportY < baseY` ⇒ scrolled up; equal ⇒ at bottom.
    const syncCursorVisibility = () => {
      const b = terminal.buffer.active;
      container.classList.toggle('argus-scrolled-up', b.viewportY < b.baseY);
    };
    const scrollDisposable = terminal.onScroll(syncCursorVisibility);

    // Delay fit to allow container to settle, then report dimensions to server
    // and only THEN join. Order matters: joining triggers the server's replay
    // snapshot (capture-pane dumps the pane at its *current* width). If we joined
    // before reporting this client's size, the pane would still be at the prior
    // client's width — pre-wrapped lines would land in a mismatched grid and
    // render garbled (focus view "cut in half", mosaic tile text misplaced).
    // Resizing first lets the server size the pane to us, so the capture matches
    // the grid we're about to render into.
    requestAnimationFrame(() => {
      if (container.offsetWidth > 0 && container.offsetHeight > 0) {
        fitAddon.fit();
        socket.emit('session:resize', {
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      }
      if (autoFocusRef.current && !readOnly) terminal.focus();
      socket.emit('session:join', sessionId);
    });

    // Re-join room on reconnect (server restart loses room membership).
    // Resize before join for the same capture-width reason as the initial mount.
    const handleReconnect = () => {
      socket.emit('session:resize', {
        sessionId,
        cols: terminal.cols,
        rows: terminal.rows,
      });
      socket.emit('session:join', sessionId);
    };
    socket.on('connect', handleReconnect);

    // Re-pull a fresh, grid-aligned replay frame (resize-then-join, same as a mount).
    // The server's join handler returns a snapshot prefixed with \x1b[2J\x1b[3J\x1b[H,
    // so this REPLACES the buffer rather than appending — the only way, short of a
    // remount, to re-align a drifted terminal.
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;
    const resync = (delay: number, joinDelay = 0) => {
      if (resyncTimer) clearTimeout(resyncTimer);
      resyncTimer = setTimeout(() => {
        socket.emit('session:resize', { sessionId, cols: terminal.cols, rows: terminal.rows });
        const doJoin = () => socket.emit('session:join', sessionId);
        if (joinDelay > 0) setTimeout(doJoin, joinDelay);
        else doJoin();
      }, delay);
    };

    // Re-align on output settle. The replay frame is bottom-anchored: its last
    // pane_height rows must map 1:1 to tmux's live screen, so in-place redraws land on
    // the screen, not on seeded scrollback. While a tile stays mounted that mapping
    // drifts (the live redraw stops overwriting the seeded copy), leaving a duplicated
    // block above the current screen — visible when scrolling a mosaic tile; entering
    // focus fixes it only because the focus mount re-joins. When output stops
    // (running -> waiting/done) the screen is stable and the user is about to read it,
    // so reseed once: flicker-free since nothing is streaming. Never reseed while
    // running (would flicker the live output).
    let lastStatus: SessionStatus | null = null;
    const handleStatus = ({ sessionId: sid, status }: { sessionId: string; status: SessionStatus }) => {
      if (sid !== sessionId) return;
      const prev = lastStatus;
      lastStatus = status;
      if (prev === 'running' && (status === 'waiting' || status === 'done')) resync(150, 300);
    };
    socket.on('session:status', handleStatus);

    // Socket -> Terminal
    const handleOutput = ({ sessionId: sid, data }: { sessionId: string; data: string }) => {
      if (sid === sessionId) {
        terminal.write(data);
      }
    };
    socket.on('session:output', handleOutput);

    if (!readOnly) terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      const binds = shortcutsRef.current;

      // Insert newline (default Shift+Enter): send ESC+CR so Claude Code inserts a newline.
      if (comboMatches(event, binds['terminal-newline'])) {
        if (event.type === 'keydown') {
          socket.emit('session:input', { sessionId, data: '\x1b\r' });
        }
        return false;
      }

      // Clear terminal (default Cmd/Ctrl+L) — matches Terminal.app convention.
      if (comboMatches(event, binds['clear-terminal'])) {
        if (event.type === 'keydown') {
          terminal.clear();
          socket.emit('session:clear-buffer', sessionId);
        }
        return false;
      }

      // Search in terminal (default Cmd/Ctrl+F): swallow the default and open the bar.
      if (comboMatches(event, binds['terminal-search'])) {
        if (event.type === 'keydown') onRequestSearchRef.current?.();
        return false;
      }

      return true;
    });

    // Terminal -> Socket (interactive only; mobile sends via the compose bar)
    const onDataDisposable = readOnly
      ? null
      : terminal.onData((data) => {
          socket.emit('session:input', { sessionId, data });
        });

    // Resize handling
    const doFit = () => {
      if (container.offsetWidth > 0 && container.offsetHeight > 0) {
        (window as Window & { __argusFit?: number }).__argusFit =
          ((window as Window & { __argusFit?: number }).__argusFit ?? 0) + 1;
        const prevCols = terminal.cols;
        const prevRows = terminal.rows;
        fitAddon.fit();
        // Column change means lines were rewrapped, which can leave the DOM
        // renderer's scrollback row elements in a stale state at the old scroll
        // position. Reset to the active buffer so the user sees correct content;
        // they can scroll up again from a clean state.
        if (terminal.cols !== prevCols) terminal.scrollToBottom();
        terminal.refresh(0, terminal.rows - 1);
        socket.emit('session:resize', {
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
        // A grid change re-sizes the tmux pane, so the seeded buffer is now wrapped
        // for the wrong width/height. Reseed an aligned frame (rows matter too — the
        // bottom-anchored replay needs xterm rows == pane_height). Debounced and
        // gated on an actual change so steady-state refreshes don't reseed.
        if (terminal.cols !== prevCols || terminal.rows !== prevRows) resync(120);
      }
    };

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      // Debounce: skip intermediate sizes during layout transitions
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(doFit, 100);
    });
    resizeObserver.observe(container);

    // Re-fit after DnD/focus layout changes - force full canvas redraw
    const handleRefit = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(doFit, 50);
    };
    window.addEventListener('terminal:refit', handleRefit);

    // Returning from the tray / regaining visibility: refit+refresh so an idle
    // terminal repaints cleanly at the current size (handles size/DPR drift).
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') handleRefit();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      if (resyncTimer) clearTimeout(resyncTimer);
      if (bellTimer) clearTimeout(bellTimer);
      resizeObserver.disconnect();
      window.removeEventListener('terminal:refit', handleRefit);
      document.removeEventListener('visibilitychange', handleVisibility);
      xtermTextarea?.removeEventListener('focus', onXtermFocus);
      xtermTextarea?.removeEventListener('blur', onXtermBlur);
      disposeMouse();
      scrollDisposable.dispose();
      onDataDisposable?.dispose();
      socket.off('session:output', handleOutput);
      socket.off('session:status', handleStatus);
      socket.off('connect', handleReconnect);
      socket.emit('session:leave', sessionId);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [sessionId, socket, containerRef, readOnly, fontsReady]);

  // Update theme without recreating the terminal
  useEffect(() => {
    const t = terminalRef.current;
    if (t) {
      t.options.theme = theme === 'dark' ? DARK_THEME : LIGHT_THEME;
      t.refresh(0, t.rows - 1);
    }
  }, [theme]);

  // Imperatively focus when requestFocusToken increments (e.g. notification click).
  useEffect(() => {
    if (!requestFocusToken) return;
    terminalRef.current?.focus();
  }, [requestFocusToken]);

  return { terminalRef, fitAddonRef, searchAddonRef };
}
