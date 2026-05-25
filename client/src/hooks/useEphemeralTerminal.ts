import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';

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

interface UseEphemeralTerminalOptions {
  id: string;
  cwd: string;
  socket: TypedSocket;
  theme: 'dark' | 'light';
}

export function useEphemeralTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: UseEphemeralTerminalOptions,
): { terminalRef: React.RefObject<Terminal | null> } {
  const { id, cwd, socket, theme } = options;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Prevents stale requestAnimationFrame callbacks (from React Strict Mode's
    // double-invoke) from emitting ephemeral:spawn after this effect is torn down.
    let cancelled = false;

    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: themeRef.current === 'dark' ? DARK_THEME : LIGHT_THEME,
      allowProposedApi: true,
      scrollback: 5000,
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    // Open synchronously so xterm's DOM (including the hidden textarea for
    // keyboard input) exists immediately — matching the pattern used by
    // useTerminal.ts for session terminals. This makes click-to-focus work
    // before the shell has even spawned.
    terminal.open(container);
    terminalRef.current = terminal;

    // Fix keyboard input: xterm positions its textarea at left:-9999em via CSS.
    // If an overflow:hidden ancestor clips that position, the textarea can't
    // receive focus. Setting position:fixed via inline setProperty('important')
    // escapes all overflow contexts. A MutationObserver re-applies the fix if
    // xterm's _syncTextArea() overwrites the inline styles (e.g. for IME support).
    type ContainerWithObserver = HTMLDivElement & { _textareaObserver?: MutationObserver };
    const applyTextareaFix = (el: HTMLElement) => {
      if (el.style.getPropertyPriority('position') !== 'important') {
        el.style.setProperty('position', 'fixed', 'important');
        el.style.setProperty('left', '0', 'important');
        el.style.setProperty('top', '0', 'important');
      }
    };
    const ta = container.querySelector<HTMLElement>('.xterm-helper-textarea');
    if (ta) {
      applyTextareaFix(ta);
      const textareaObserver = new MutationObserver(() => applyTextareaFix(ta));
      textareaObserver.observe(ta, { attributes: true, attributeFilter: ['style'] });
      (container as ContainerWithObserver)._textareaObserver = textareaObserver;
    }

    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      // Shift+Enter: send ESC+CR so Claude Code (if run inside) inserts a newline
      if (
        event.key === 'Enter' &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        if (event.type === 'keydown') {
          socket.emit('ephemeral:input', { id, data: '\x1b\r' });
        }
        return false;
      }
      return true;
    });

    // Wire up keyboard input immediately after open()
    const onDataDisposable = terminal.onData((data) => {
      socket.emit('ephemeral:input', { id, data });
    });

    // Defer fit + spawn until the container has non-zero dimensions. The shell
    // is spawned only after fit() so the prompt appears at the correct position
    // in the sized terminal, not in the center of an oversized container.
    let focusedOnOutput = false;
    const handleOutput = ({ id: eid, data }: { id: string; data: string }) => {
      if (eid !== id) return;
      terminal.write(data);
      // Fallback focus: guarantee focus once the shell has produced output,
      // in case the initial terminal.focus() call below didn't stick.
      if (!focusedOnOutput) {
        focusedOnOutput = true;
        terminal.focus();
      }
    };
    socket.on('ephemeral:output', handleOutput);

    let spawnAttempts = 0;
    const trySpawn = () => {
      if (cancelled) return;
      if (container.offsetWidth > 0 && container.offsetHeight > 0) {
        fitAddon.fit();
        socket.emit('ephemeral:spawn', { id, cwd });
        socket.emit('ephemeral:resize', { id, cols: terminal.cols, rows: terminal.rows });
        terminal.focus();
      } else if (spawnAttempts < 10) {
        spawnAttempts++;
        setTimeout(trySpawn, 50);
      } else {
        // Fallback: spawn without confirmed dimensions
        socket.emit('ephemeral:spawn', { id, cwd });
        terminal.focus();
      }
    };
    requestAnimationFrame(trySpawn);

    // Full refit: fit, refresh canvas, emit resize, re-apply textarea fix.
    // Used by terminal:refit handler (fires after layout changes settle).
    const doFit = () => {
      if (container.offsetWidth > 0 && container.offsetHeight > 0) {
        const prevCols = terminal.cols;
        const prevRows = terminal.rows;
        fitAddon.fit();
        terminal.refresh(0, terminal.rows - 1);
        if (terminal.cols !== prevCols || terminal.rows !== prevRows) {
          socket.emit('ephemeral:resize', { id, cols: terminal.cols, rows: terminal.rows });
        }
        // Re-apply textarea fix in case xterm re-synced while hidden
        const ta2 = container.querySelector<HTMLElement>('.xterm-helper-textarea');
        if (ta2) applyTextareaFix(ta2);
      }
    };

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (container.offsetWidth > 0 && container.offsetHeight > 0) {
          fitAddon.fit();
          // No terminal.refresh() here — avoid per-frame cost during drag.
          // The terminal:refit event fires after drag ends and calls doFit().
          socket.emit('ephemeral:resize', { id, cols: terminal.cols, rows: terminal.rows });
        }
      }, 100);
    });
    resizeObserver.observe(container);

    // Re-fit after layout changes (DnD, resize divider release, tab switches).
    // Matches the pattern from useTerminal.ts for session terminals.
    const handleRefit = () => {
      if (cancelled) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (cancelled) return;
        doFit();
      }, 50);
    };
    window.addEventListener('terminal:refit', handleRefit);

    return () => {
      cancelled = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('terminal:refit', handleRefit);
      resizeObserver.disconnect();
      (container as ContainerWithObserver)._textareaObserver?.disconnect();
      onDataDisposable.dispose();
      socket.off('ephemeral:output', handleOutput);
      socket.emit('ephemeral:kill', { id });
      terminal.dispose();
      terminalRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, socket, cwd]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = theme === 'dark' ? DARK_THEME : LIGHT_THEME;
    }
  }, [theme]);

  return { terminalRef };
}
