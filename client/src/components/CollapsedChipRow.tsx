import type { SessionInfo } from '@argus/shared';
import { CollapsedSessionChip } from './CollapsedSessionChip.js';

interface CollapsedChipRowProps {
  sessions: SessionInfo[];
  onUncollapse: (id: string) => void;
}

export function CollapsedChipRow({ sessions, onUncollapse }: CollapsedChipRowProps) {
  if (sessions.length === 0) return null;

  return (
    <div
      className="collapsed-chip-row"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--space-2)',
        padding: 'var(--space-2)',
        flexShrink: 0,
        borderBottom: '1px solid var(--color-border-base)',
        background: 'var(--color-bg-base)',
        alignItems: 'center',
      }}
    >
      <span
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          fontWeight: 500,
          flexShrink: 0,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        Minimized
      </span>
      {sessions.map((session) => (
        <CollapsedSessionChip
          key={session.id}
          session={session}
          onUncollapse={onUncollapse}
        />
      ))}
    </div>
  );
}
