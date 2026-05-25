import type { SessionInfo } from '@argus/shared';
import { StatusDot, Badge, Tooltip } from './primitives/index.js';
import { AlertTriangle } from 'lucide-react';
import { STATUS_COLORS } from '../constants/status.js';

interface CollapsedSessionChipProps {
  session: SessionInfo;
  onUncollapse: (id: string) => void;
}

export function CollapsedSessionChip({ session, onUncollapse }: CollapsedSessionChipProps) {
  const statusColor = STATUS_COLORS[session.status] ?? STATUS_COLORS.idle;

  return (
    <Tooltip content={`Click to restore — ${session.folderPath}`} position="bottom">
      <button
        onClick={() => onUncollapse(session.id)}
        aria-label={`Restore session ${session.name}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px 4px 8px',
          border: `1px solid ${statusColor}`,
          borderLeft: `3px solid ${statusColor}`,
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-bg-elevated)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          transition: 'background var(--transition-fast), box-shadow var(--transition-fast)',
          boxShadow: session.status === 'waiting'
            ? undefined  // let animation control it
            : session.status !== 'exited'
              ? `0 0 6px ${statusColor}33`
              : undefined,
          animation: session.status === 'waiting'
            ? 'waiting-breathe 1.4s ease-in-out infinite'
            : undefined,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--color-bg-surface)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--color-bg-elevated)';
        }}
      >
        <StatusDot status={session.status} pulse={session.status === 'running' || session.status === 'waiting'} size={7} />
        <span
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            maxWidth: '120px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {session.name}
        </span>
        {session.hasGitChanges && (
          <AlertTriangle size={12} color="var(--color-status-waiting)" strokeWidth={2} style={{ flexShrink: 0 }} />
        )}
        <Badge label={session.agentType} />
      </button>
    </Tooltip>
  );
}
