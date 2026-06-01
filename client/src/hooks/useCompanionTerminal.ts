import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { isMac, isPrimaryModifier } from '../utils/platform.js';
import { disableMouseReporting } from './terminalMouse.js';

import '@xterm/xterm/css/xterm.css';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

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

interface UseCompanionTerminalOptions {
  sessionId: string;
  socket: TypedSocket;
  theme: 'dark' | 'light';
}

export function useCompanionTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: UseCompanionTerminalOptions,
) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { sessionId, socket, theme } = options;
  const themeRef = useRef(theme);
  useEffect(() => { themeRef.current = theme; }, [theme]);
  const [terminalAlive, setTerminalAlive] = useState(true);

  // See useTerminal: re-init once web fonts are ready so cold-start char-cell
  // measurement isn't baked with a not-yet-loaded font (garbled box-drawing).
  const [fontsReady, setFontsReady] = useState(
    () => typeof document === 'undefined' || document.fonts?.status === 'loaded',
  );
  useEffect(() => {
    if (fontsReady || !document.fonts?.ready) return;
    let cancelled = false;
    document.fonts.ready.then(() => { if (!cancelled) setFontsReady(true); });
    return () => { cancelled = true; };
  }, [fontsReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setTerminalAlive(true);

    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      cursorBlink: true,
      disableStdin: false,
      fontSize: 13,
      fontFamily: '"SF Mono", ui-monospace, Menlo, Monaco, "Cascadia Code", monospace',
      theme: themeRef.current === 'dark' ? DARK_THEME : LIGHT_THEME,
      allowProposedApi: true,
      scrollback: 5000,
      scrollSensitivity: 3,
      fastScrollSensitivity: 10,
      macOptionIsMeta: isMac,
    });

    terminal.onBell(() => {
      const el = container as HTMLElement;
      el.classList.remove('terminal-bell-flash');
      void el.offsetWidth;
      el.classList.add('terminal-bell-flash');
      window.setTimeout(() => el.classList.remove('terminal-bell-flash'), 200);
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    // Drop mouse reporting so plain click-drag does native text selection.
    disableMouseReporting(terminal);

    terminal.open(container);
    // Built-in DOM renderer (no WebGL/Canvas addon) — see useTerminal for why.

    requestAnimationFrame(() => {
      if (container.offsetWidth > 0 && container.offsetHeight > 0) {
        fitAddon.fit();
        socket.emit('ct:resize', { sessionId, cols: terminal.cols, rows: terminal.rows });
      }
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    socket.emit('ct:join', sessionId);

    const handleReconnect = () => {
      socket.emit('ct:join', sessionId);
      socket.emit('ct:resize', { sessionId, cols: terminal.cols, rows: terminal.rows });
    };
    socket.on('connect', handleReconnect);

    const handleOutput = ({ sessionId: sid, data }: { sessionId: string; data: string }) => {
      if (sid === sessionId) terminal.write(data);
    };
    socket.on('ct:output', handleOutput);

    const handleExit = ({ sessionId: sid }: { sessionId: string; exitCode: number }) => {
      if (sid === sessionId) setTerminalAlive(false);
    };
    socket.on('ct:exit', handleExit);

    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (isPrimaryModifier(event) && (event.key === 'l' || event.key === 'L')) {
        if (event.type === 'keydown') terminal.clear();
        return false;
      }
      return true;
    });

    const onDataDisposable = terminal.onData((data) => {
      socket.emit('ct:input', { sessionId, data });
    });

    const doFit = () => {
      if (container.offsetWidth > 0 && container.offsetHeight > 0) {
        fitAddon.fit();
        terminal.refresh(0, terminal.rows - 1);
        socket.emit('ct:resize', { sessionId, cols: terminal.cols, rows: terminal.rows });
      }
    };

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(doFit, 100);
    });
    resizeObserver.observe(container);

    const handleRefit = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(doFit, 50);
    };
    window.addEventListener('terminal:refit', handleRefit);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') handleRefit();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      window.removeEventListener('terminal:refit', handleRefit);
      document.removeEventListener('visibilitychange', handleVisibility);
      onDataDisposable.dispose();
      socket.off('ct:output', handleOutput);
      socket.off('ct:exit', handleExit);
      socket.off('connect', handleReconnect);
      socket.emit('ct:leave', sessionId);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, socket, containerRef, fontsReady]);

  // Update theme without recreating the terminal
  useEffect(() => {
    const t = terminalRef.current;
    if (t) {
      t.options.theme = theme === 'dark' ? DARK_THEME : LIGHT_THEME;
      t.refresh(0, t.rows - 1);
    }
  }, [theme]);

  return { terminalRef, fitAddonRef, terminalAlive };
}
