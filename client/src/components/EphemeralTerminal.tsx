import { useRef, useMemo } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { X as XIcon, Terminal } from 'lucide-react';
import { useEphemeralTerminal } from '../hooks/useEphemeralTerminal.js';

import '@xterm/xterm/css/xterm.css';
import './EphemeralTerminal.css';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface EphemeralTerminalProps {
  cwd: string;
  socket: TypedSocket | undefined;
  theme: 'dark' | 'light';
  onClose: () => void;
}

export function EphemeralTerminal({ cwd, socket, theme, onClose }: EphemeralTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Stable ID for this terminal instance — regenerated if cwd changes (new mount)
  const id = useMemo(() => crypto.randomUUID(), [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  const { terminalRef } = useEphemeralTerminal(containerRef, {
    id,
    cwd,
    socket: socket!,
    theme,
  });

  if (!socket) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
        Not connected
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: theme === 'dark' ? '#1a1b26' : '#f5f5f5' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 8px',
        borderBottom: '1px solid var(--color-border-base)',
        background: 'var(--color-bg-elevated)',
        flexShrink: 0,
      }}>
        <Terminal size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        <span style={{
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-text-muted)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {cwd}
        </span>
        <button
          onClick={onClose}
          title="Close terminal"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px',
            display: 'inline-flex',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-muted)',
            transition: 'color var(--transition-fast)',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
        >
          <XIcon size={13} strokeWidth={1.75} />
        </button>
      </div>

      {/* Terminal */}
      <div
        ref={containerRef}
        className="ephemeral-terminal-host"
        onMouseDown={() => terminalRef.current?.focus()}
        style={{ flex: 1, minHeight: 0, padding: '4px', cursor: 'text' }}
      />
    </div>
  );
}
