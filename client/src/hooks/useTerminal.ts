import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, SessionStatus, SessionReplay } from '@argus/shared';
import { comboMatches } from '../keyboard/combo.js';
import { resolveShortcuts, type ResolvedShortcuts } from '../keyboard/useShortcuts.js';
import { installSelectableMouse } from './terminalMouse.js';
import { terminalSelectionToClipboard } from './terminalCopy.js';
import { ResizeEmitGate } from './resizeGate.js';
import { shouldPaintReplay, shouldRequestResync } from './replayPolicy.js';
import { openExternal } from '../utils/openExternal.js';
import { useFontSettings } from '../context/font-settings-context.js';

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
  /**
   * Hold back `session:resize` while the user is dragging a layout divider. The
   * terminal still refits locally; only the pty is spared the intermediate widths
   * (each one costs a duplicated, wrongly-wrapped block — see ResizeEmitGate).
   * The caller must dispatch `terminal:refit` when the drag ends.
   */
  suspendResize?: boolean;
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
  const { sessionId, socket, theme, readOnly = false, onFocusChange, autoFocus = false, shortcuts, onRequestSearch, requestFocusToken, suspendResize = false } = options;
  // Rebuilt with the terminal (see the create effect) so a fresh grid always
  // reports itself once; read through a ref by the font-size effect too.
  const resizeGateRef = useRef(new ResizeEmitGate());
  const suspendResizeRef = useRef(suspendResize);
  useEffect(() => { suspendResizeRef.current = suspendResize; }, [suspendResize]);
  const themeRef = useRef(theme);
  useEffect(() => { themeRef.current = theme; }, [theme]);
  const { codeFontSize } = useFontSettings();
  // Read at create time via ref so a size change live-updates instead of rebuilding.
  const codeFontSizeRef = useRef(codeFontSize);
  useEffect(() => { codeFontSizeRef.current = codeFontSize; }, [codeFontSize]);
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

    // Fresh grid, fresh gate: this terminal has told the server nothing yet.
    const resizeGate = new ResizeEmitGate();
    resizeGateRef.current = resizeGate;
    const emitResize = (cols: number, rows: number, opts?: { force?: boolean }) => {
      if (!resizeGate.request(cols, rows, { ...opts, suspended: suspendResizeRef.current })) return;
      socket.emit('session:resize', { sessionId, cols, rows });
    };

    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      cursorBlink: !readOnly,
      disableStdin: readOnly,
      fontSize: codeFontSizeRef.current,
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
      bellTimer = setTimeout(() => el.classList.remove('terminal-bell-flash'), 200);
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
    const { dispose: disposeMouse, reconcileMouse } = installSelectableMouse(
      terminal, container, sessionId,
      sendInput, // always defined — even readOnly (mobile) forwards touch scroll
      undefined, // kind — default storage key
    );

    const xtermTextarea = container.querySelector<HTMLTextAreaElement>('textarea');
    const onXtermFocus = () => onFocusChangeRef.current?.(true);
    const onXtermBlur  = () => onFocusChangeRef.current?.(false);
    xtermTextarea?.addEventListener('focus', onXtermFocus);
    xtermTextarea?.addEventListener('blur', onXtermBlur);

    // Copy: substitute xterm's own getSelection() into the clipboard. The DOM
    // renderer paints each buffer row as a separate element, so Chromium's
    // native selection serializer joins rows with spaces — multi-line commands
    // paste as one broken line. getSelection() emits real `\n` at hard row
    // boundaries and joins soft-wrapped lines without a break. One `copy`
    // listener covers both Cmd+C and the Electron Edit-menu `{ role: 'copy' }`.
    //
    // getSelection() alone still pastes badly, because the agent wraps and
    // gutters its output itself — every row arrives as a hard line with a left
    // indent, so there is no soft wrap left for xterm to join. See terminalCopy.
    const handleCopy = (e: ClipboardEvent) => {
      if (!terminal.hasSelection()) return;
      e.clipboardData?.setData('text/plain', terminalSelectionToClipboard(terminal.getSelection()));
      e.preventDefault();
    };
    container.addEventListener('copy', handleCopy);

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
        // Forced: the join below replays a frame built for whatever size the
        // server thinks we are, so it must hear ours first even mid-drag.
        emitResize(terminal.cols, terminal.rows, { force: true });
      }
      if (autoFocusRef.current && !readOnly) terminal.focus();
      socket.emit('session:join', sessionId);
    });

    // Re-join room on reconnect (server restart loses room membership).
    // Resize before join for the same capture-width reason as the initial mount.
    const handleReconnect = () => {
      // Forced: after a server restart it has no record of our size.
      emitResize(terminal.cols, terminal.rows, { force: true });
      socket.emit('session:join', sessionId);
    };
    socket.on('connect', handleReconnect);

    // Re-pull a grid-aligned replay frame (resize first, so the server builds the
    // frame for our grid). `session:resync` — not `session:join` — because the
    // buffer here is not stale: it holds correct history and only the screen has
    // drifted. The server answers with a screen-only frame (no \x1b[3J), so this
    // realigns without erasing the scrollback the reader may be sitting in.
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;
    const resync = (delay: number, frameDelay = 0) => {
      if (resyncTimer) clearTimeout(resyncTimer);
      resyncTimer = setTimeout(() => {
        // Unforced: whatever changed the grid already reported it. This emit only
        // exists to guarantee ordering (server sized before it builds the frame).
        emitResize(terminal.cols, terminal.rows);
        const askFrame = () => socket.emit('session:resync', sessionId);
        if (frameDelay > 0) setTimeout(askFrame, frameDelay);
        else askFrame();
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
    //
    // A scrolled-up reader is no longer excluded: the resync frame is screen-only,
    // so realigning them costs nothing (see replayPolicy). The alternate buffer
    // still is — its frames degrade to full ones server-side, and its real target
    // here is normal-buffer scrollback (the mosaic-drift reseed) anyway.
    let lastStatus: SessionStatus | null = null;
    const handleStatus = ({ sessionId: sid, status }: { sessionId: string; status: SessionStatus }) => {
      if (sid !== sessionId) return;
      const prev = lastStatus;
      lastStatus = status;
      if (prev === 'running' && (status === 'waiting' || status === 'done')) {
        const b = terminal.buffer.active;
        if (!shouldRequestResync({ bufferType: b.type, scrolledUp: b.viewportY < b.baseY })) return;
        resync(150, 300);
      }
    };
    socket.on('session:status', handleStatus);

    // Socket -> Terminal: steady-state streaming.
    const handleOutput = ({ sessionId: sid, data }: { sessionId: string; data: string }) => {
      if (sid === sessionId) {
        terminal.write(data);
      }
    };
    socket.on('session:output', handleOutput);

    // Lines-from-bottom to re-apply after the next reseed frame paints. A refit that
    // changes cols must reseed (skipping it leaves rewrapped duplicate blocks in the
    // scrollback), and the reseed frame opens with \x1b[3J which lands at the bottom.
    // Restoring the offset afterwards keeps a rotating reader near their place
    // without giving up the reseed's correctness. 0 = nothing pending.
    let pendingScrollRestore = 0;

    // Authoritative replay (join/reconnect/resync). Reconcile the wheel-forwarding
    // gate to tmux's truth BEFORE painting, then refresh once the frame parses so
    // the buffer-mode flip (?1049l/h in the frame) leaves no stale DOM rows.
    const handleReplay = ({ sessionId: sid, data, appMouse, sgr, reason }: SessionReplay) => {
      if (sid !== sessionId) return;
      const buf = terminal.buffer.active;
      if (!shouldPaintReplay(reason, buf.viewportY < buf.baseY)) return;
      reconcileMouse(appMouse, sgr);
      terminal.write(data, () => {
        terminal.refresh(0, terminal.rows - 1);
        if (pendingScrollRestore > 0) {
          const lines = pendingScrollRestore;
          pendingScrollRestore = 0;
          // The seeded scrollback may be shallower than the reader was deep, in
          // which case this lands at the top — still nearer than the tail.
          terminal.scrollLines(-lines);
        }
      });
    };
    socket.on('session:replay', handleReplay);

    if (!readOnly) terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      const binds = shortcutsRef.current;

      // Insert newline (default Shift+Enter): send ESC+CR so Claude Code inserts a newline.
      if (comboMatches(event, binds['terminal-newline'])) {
        if (event.type === 'keydown') {
          socket.emit('session:input', { sessionId, data: '\x1b\r' });
        }
        return false;
      }

      // Clear terminal (default Cmd/Ctrl+L): purge scrollback, keep the screen.
      // ED 3 locally for instant feedback; the server clears the mirror's history
      // too and broadcasts an authoritative frame, so the rows stay gone across
      // joins and resyncs. Deliberately NOT terminal.clear() (which keeps only the
      // cursor row): the mirror's screen must keep matching what the agent thinks
      // it painted, or its next partial repaint lands on a blank grid.
      if (comboMatches(event, binds['clear-terminal'])) {
        if (event.type === 'keydown') {
          terminal.write('\x1b[3J');
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
        // How far up the reader was, in lines from the bottom. Rotating a phone
        // changes cols, and the branch below used to snap such a refit straight to
        // the bottom — losing the reader's place mid-scrollback. Capture first.
        const before = terminal.buffer.active;
        const linesFromBottom = Math.max(0, before.baseY - before.viewportY);
        const wasScrolledUp = linesFromBottom > 0;
        fitAddon.fit();
        // FitAddon derives cols from one measured cell, but at fractional zoom
        // the DOM renderer's real per-cell advance differs sub-pixel from that
        // measurement — across ~200 columns the error accumulates past the
        // panel's side padding, so the last glyphs touch or clip the tile
        // border. Measure the grid the renderer actually produced and shave
        // columns until it genuinely fits the mount width.
        const screenEl = terminal.element?.querySelector<HTMLElement>('.xterm-screen');
        if (terminal.element && screenEl && terminal.cols > 2) {
          const avail = terminal.element.getBoundingClientRect().width;
          const actual = screenEl.getBoundingClientRect().width;
          if (actual > avail && avail > 0) {
            const cellW = actual / terminal.cols;
            const maxCols = Math.max(2, Math.floor(avail / cellW));
            if (maxCols < terminal.cols) terminal.resize(maxCols, terminal.rows);
          }
        }
        // Column change means lines were rewrapped, which can leave the DOM
        // renderer's scrollback row elements in a stale state at the old scroll
        // position. Reset to the active buffer so the user sees correct content.
        if (terminal.cols !== prevCols) terminal.scrollToBottom();
        terminal.refresh(0, terminal.rows - 1);
        emitResize(terminal.cols, terminal.rows);
        // A grid change re-sizes the tmux pane, so the seeded buffer is now wrapped
        // for the wrong width/height. Reseed an aligned frame (rows matter too — the
        // bottom-anchored replay needs xterm rows == pane_height). Debounced and
        // gated on an actual change so steady-state refreshes don't reseed.
        // Skip while a drag holds the pty at its old grid — reseeding now would
        // paint a frame wrapped for that grid into our already-refitted one. The
        // refit dispatched at drag end reseeds properly.
        const willResync =
          !suspendResizeRef.current && (terminal.cols !== prevCols || terminal.rows !== prevRows);
        // Rotating a phone changes cols, and the scrollToBottom above would leave a
        // reader who was mid-scrollback pinned to the tail. Hand the offset to the
        // reseed frame (which is what actually repaints) rather than restoring it
        // here, where the incoming \x1b[3J would immediately undo it.
        if (wasScrolledUp) {
          if (willResync) pendingScrollRestore = linesFromBottom;
          else if (terminal.cols !== prevCols) terminal.scrollLines(-linesFromBottom);
        }
        if (willResync) resync(120);
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

    // Reopening the window / regaining visibility: refit+refresh so an idle
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
      container.removeEventListener('copy', handleCopy);
      disposeMouse();
      scrollDisposable.dispose();
      onDataDisposable?.dispose();
      socket.off('session:output', handleOutput);
      socket.off('session:replay', handleReplay);
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

  // Update font size without recreating the terminal; refit so cols/rows recompute.
  useEffect(() => {
    const t = terminalRef.current;
    if (!t || t.options.fontSize === codeFontSize) return;
    t.options.fontSize = codeFontSize;
    const container = containerRef.current;
    // Skip fit()+resize while collapsed (e.g. a maximized workbench panel sets
    // this tile to 0x0) — proposeDimensions() clamps degenerate sizes instead
    // of bailing, so fitting here would resize the real pty to ~2x1 and garble it.
    if (!container || container.offsetWidth === 0 || container.offsetHeight === 0) return;
    fitAddonRef.current?.fit();
    // fit() only resizes the local xterm buffer — without this the pty stays
    // at the old size until some other trigger happens to refit, garbling output.
    if (resizeGateRef.current.request(t.cols, t.rows, { suspended: suspendResizeRef.current })) {
      socket.emit('session:resize', { sessionId, cols: t.cols, rows: t.rows });
    }
  }, [codeFontSize, sessionId, socket, containerRef]);

  // Imperatively focus when requestFocusToken increments (e.g. notification click).
  useEffect(() => {
    if (!requestFocusToken) return;
    terminalRef.current?.focus();
  }, [requestFocusToken]);

  return { terminalRef, fitAddonRef, searchAddonRef };
}
