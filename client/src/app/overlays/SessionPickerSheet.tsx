import type { SessionInfo } from '@argus/shared';
import { Sheet, StatusPill } from '../../components/primitives/index.js';
import { AgentGlyph } from '../ui/AgentGlyph.js';

interface SessionPickerSheetProps {
  sessions: SessionInfo[];
  target: 'diff' | 'explorer';
  onClose: () => void;
  onPick: (id: string) => void;
}

export function SessionPickerSheet({ sessions, target, onClose, onPick }: SessionPickerSheetProps) {
  const title = target === 'diff' ? 'Open Diff' : 'Open Files';
  return (
    <Sheet
      eyebrow="Pick a shell"
      title={title}
      subtitle="No shell is open — choose which one to inspect."
      onClose={onClose}
      width={460}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
        {sessions.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.id)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--s-3)',
              padding: 'var(--s-3)',
              background: 'var(--bg-2)',
              border: '1px solid var(--line-2)',
              borderRadius: 'var(--r-2)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-edge)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line-2)'; }}
          >
            <AgentGlyph agent={s.agentType} size={18} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--t-sm)',
                  color: 'var(--fg-0)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.folderPath}
              </div>
              <div className="eyebrow" style={{ marginTop: 2 }}>
                {s.agentType}
              </div>
            </div>
            <StatusPill status={s.status} size="sm" />
          </button>
        ))}
      </div>
    </Sheet>
  );
}
