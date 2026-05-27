import type { SessionInfo } from '@argus/shared';
import { StatusDot } from '../../components/primitives/index.js';
import { AgentGlyph } from './AgentGlyph.js';

interface ChipStripProps {
  sessions: SessionInfo[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function ChipStrip({ sessions, activeId, onSelect }: ChipStripProps) {
  const others = sessions.filter((s) => s.id !== activeId);
  return (
    <div
      className="argus-scroll"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-2)',
        padding: 'var(--s-1) var(--s-4)',
        background: 'var(--bg-1)',
        borderBottom: '1px solid var(--line-2)',
        overflowX: 'auto',
        flexShrink: 0,
      }}
    >
      <span className="eyebrow" style={{ marginRight: 'var(--s-2)', flexShrink: 0 }}>
        OTHERS · {others.length}
      </span>
      {others.map((s) => (
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          style={{
            all: 'unset',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px var(--s-2)',
            background: 'var(--bg-2)',
            border: '1px solid var(--line-2)',
            borderRadius: 'var(--r-2)',
            flexShrink: 0,
            position: 'relative',
          }}
        >
          <StatusDot status={s.status} size={6} />
          <AgentGlyph agent={s.agentType} size={14} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)', color: 'var(--fg-1)' }}>
            {s.name}
          </span>
          {s.hasGitChanges && (
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--dirty)' }} />
          )}
        </button>
      ))}
    </div>
  );
}
