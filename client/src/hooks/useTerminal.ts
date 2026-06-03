import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { isPrimaryModifier } from '../utils/platform.js';
import { installSelectableMouse } from './terminalMouse.js';

import '@xterm/xterm/css/xterm.css';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface UseTerminalOptions {
  sessionId: string;
  socket: TypedSocket;
  theme: 'dark' | 'light';
  /** Display-only: no stdin, no keyboard capture (mobile feeds input via a separate compose bar). */
  readOnly?: boolean;
  /** Called (debounced) with the bottom non-empty terminal row — used for mobile chip detection. */
  onTail?: (line: string) => void;
  /** Called when xterm gains or loses keyboard focus. */
  onFocusChange?: (focused: boolean) => void;
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
  const { sessionId, socket, theme, readOnly = false, onTail, onFocusChange } = options;
  const themeRef = useRef(theme);
  useEffect(() => { themeRef.current = theme; }, [theme]);
  const onTailRef = useRef(onTail);
  useEffect(() => { onTailRef.current = onTail; }, [onTail]);
  const onFocusChangeRef = useRef(onFocusChange);
  useEffect(() => { onFocusChangeRef.current = onFocusChange; }, [onFocusChange]);

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
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(container);

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

    // Delay fit to allow container to settle, then report dimensions to server
    requestAnimationFrame(() => {
      if (container.offsetWidth > 0 && container.offsetHeight > 0) {
        fitAddon.fit();
        socket.emit('session:resize', {
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      }
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Join socket room
    socket.emit('session:join', sessionId);

    // Re-join room on reconnect (server restart loses room membership)
    const handleReconnect = () => {
      socket.emit('session:join', sessionId);
      socket.emit('session:resize', {
        sessionId,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    };
    socket.on('connect', handleReconnect);

    // Debounced read of the bottom non-empty buffer row (read-only / mobile chip detection)
    let tailTimer: ReturnType<typeof setTimeout> | null = null;
    const emitTail = () => {
      if (!onTailRef.current) return;
      const buf = terminal.buffer.active;
      for (let y = buf.baseY + terminal.rows - 1; y >= 0; y--) {
        const text = buf.getLine(y)?.translateToString(true) ?? '';
        if (text.trim() !== '') { onTailRef.current(text); return; }
      }
      onTailRef.current('');
    };

    // Socket -> Terminal
    const handleOutput = ({ sessionId: sid, data }: { sessionId: string; data: string }) => {
      if (sid === sessionId) {
        terminal.write(data);
        if (onTailRef.current) {
          if (tailTimer) clearTimeout(tailTimer);
          tailTimer = setTimeout(emitTail, 150);
        }
      }
    };
    socket.on('session:output', handleOutput);

    if (!readOnly) terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      // Shift+Enter: send ESC+CR so Claude Code inserts a newline
      if (
        event.key === 'Enter' &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        if (event.type === 'keydown') {
          socket.emit('session:input', { sessionId, data: '\x1b\r' });
        }
        return false;
      }

      // Cmd+L (Mac) or Ctrl+L (others) clears the terminal — matches Terminal.app convention.
      // Cmd+K is reserved for the global Command Palette (see App.tsx).
      if (isPrimaryModifier(event) && (event.key === 'l' || event.key === 'L')) {
        if (event.type === 'keydown') {
          terminal.clear();
          socket.emit('session:clear-buffer', sessionId);
        }
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
        fitAddon.fit();
        terminal.refresh(0, terminal.rows - 1);
        socket.emit('session:resize', {
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
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
      if (tailTimer) clearTimeout(tailTimer);
      if (bellTimer) clearTimeout(bellTimer);
      resizeObserver.disconnect();
      window.removeEventListener('terminal:refit', handleRefit);
      document.removeEventListener('visibilitychange', handleVisibility);
      xtermTextarea?.removeEventListener('focus', onXtermFocus);
      xtermTextarea?.removeEventListener('blur', onXtermBlur);
      disposeMouse();
      onDataDisposable?.dispose();
      socket.off('session:output', handleOutput);
      socket.off('connect', handleReconnect);
      socket.emit('session:leave', sessionId);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
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

  return { terminalRef, fitAddonRef };
}
