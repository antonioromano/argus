import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';

import '@xterm/xterm/css/xterm.css';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface UseTerminalOptions {
  sessionId: string;
  socket: TypedSocket;
  theme: 'dark' | 'light';
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
  const { sessionId, socket, theme } = options;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // Create terminal and wire up socket
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: themeRef.current === 'dark' ? DARK_THEME : LIGHT_THEME,
      allowProposedApi: true,
      scrollback: 5000,
      scrollSensitivity: 3,
      fastScrollSensitivity: 10,
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(container);

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

    // Socket -> Terminal
    const handleOutput = ({ sessionId: sid, data }: { sessionId: string; data: string }) => {
      if (sid === sessionId) {
        terminal.write(data);
      }
    };
    socket.on('session:output', handleOutput);

    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
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

      // Cmd+K/L (Mac) or Ctrl+K/L (non-Mac) clears the terminal
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const modifier = isMac ? event.metaKey : event.ctrlKey;
      if (modifier && (event.key === 'k' || event.key === 'K' || event.key === 'l' || event.key === 'L')) {
        if (event.type === 'keydown') {
          terminal.clear();
          socket.emit('session:clear-buffer', sessionId);
        }
        return false;
      }
      return true;
    });

    // Terminal -> Socket
    const onDataDisposable = terminal.onData((data) => {
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

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      window.removeEventListener('terminal:refit', handleRefit);
      onDataDisposable.dispose();
      socket.off('session:output', handleOutput);
      socket.off('connect', handleReconnect);
      socket.emit('session:leave', sessionId);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, socket, containerRef]);

  // Update theme without recreating the terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = theme === 'dark' ? DARK_THEME : LIGHT_THEME;
    }
  }, [theme]);

  return { terminalRef, fitAddonRef };
}
