import { useMemo } from 'react';
import type { SessionInfo } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { useSortable } from '@dnd-kit/sortable';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Move } from 'lucide-react';
import { TerminalPanel } from './TerminalPanel.js';
import { Tooltip } from './primitives/index.js';
import { ErrorBoundary } from './ErrorBoundary.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface SessionGroupProps {
  folderPath: string;
  sessions: SessionInfo[];
  socket: TypedSocket;
  theme: 'dark' | 'light';
  onDeleteSession: (id: string) => void;
  onRestartSession: (id: string) => void;
  onCloneSession: (folderPath: string, agentType?: string) => void;
  onFocusSession?: (id: string) => void;
  onToggleDiff?: (id: string) => void;
  onToggleExplorer?: (id: string) => void;
  onCollapse?: (id: string) => void;
  focusedSessionId?: string | null;
}

export function SessionGroup({
  folderPath,
  sessions,
  socket,
  theme,
  onDeleteSession,
  onRestartSession,
  onCloneSession,
  onFocusSession,
  onToggleDiff,
  onToggleExplorer,
  onCollapse,
  focusedSessionId,
}: SessionGroupProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: `group::${folderPath}`,
  });

  const sessionSortableIds = useMemo(
    () => sessions.map((s) => `session::${s.id}`),
    [sessions],
  );

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      className="session-group-card"
      style={{
        ...style,
        flex: 1,
        borderLeft: 'none',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-2)',
        background: 'var(--color-bg-surface)',
        overflow: 'hidden',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 6px',
          marginBottom: '4px',
          flexShrink: 0,
          background: 'var(--color-bg-elevated)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <Tooltip content="Drag to reorder group" position="bottom">
            <span
              {...attributes}
              {...listeners}
              style={{
                cursor: 'grab',
                color: 'var(--color-text-muted)',
                flexShrink: 0,
                userSelect: 'none',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              <Move size={14} strokeWidth={1.75} />
            </span>
          </Tooltip>
          <span
            style={{
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {folderPath}
          </span>
          <span
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-muted)',
              background: 'var(--color-bg-base)',
              padding: '1px 6px',
              borderRadius: 'var(--radius-pill)',
              flexShrink: 0,
            }}
          >
            {sessions.length}
          </span>
        </div>

        <Tooltip content="New session in this folder" position="left">
          <button
            onClick={() => onCloneSession(folderPath)}
            className="hover-bg-surface"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              padding: 0,
              transition: 'background var(--transition-fast), color var(--transition-fast)',
            }}
            aria-label="New session in this folder"
          >
            <Plus size={14} strokeWidth={2} />
          </button>
        </Tooltip>
      </div>

      <SortableContext items={sessionSortableIds} strategy={rectSortingStrategy}>
        <div
          className="session-group-grid"
          style={{
            display: 'grid',
            gap: 'var(--space-2)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(600px, 100%), 1fr))',
            gridAutoRows: '1fr',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {sessions.filter((s) => s.id !== focusedSessionId).map((session) => (
            <ErrorBoundary key={session.id} label={session.name}>
              <TerminalPanel
                session={session}
                socket={socket}
                theme={theme}
                onDelete={onDeleteSession}
                onRestart={onRestartSession}
                onFocus={onFocusSession}
                onCollapse={onCollapse}
                onToggleDiff={onToggleDiff}
                onToggleExplorer={onToggleExplorer}
                onCloneSession={onCloneSession}
              />
            </ErrorBoundary>
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
