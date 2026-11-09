import type { SessionInfo } from '@argus/shared';
import { Sheet, StatusPill, Stack, Text } from '../../components/primitives/index.js';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { displayStatus } from '../../utils/displayStatus.js';

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
      eyebrow="Pick a session"
      title={title}
      subtitle="No session is open — choose which one to inspect."
      onClose={onClose}
      width={460}
    >
      <Stack gap={2}>
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
              <Text as="div" mono size="body" truncate style={{ color: 'var(--fg-0)' }}>
                {s.folderPath}
              </Text>
              <div className="eyebrow" style={{ marginTop: 'var(--s-0-5)' }}>
                {s.agentType}
              </div>
            </div>
            <StatusPill status={displayStatus(s)} size="sm" />
          </button>
        ))}
      </Stack>
    </Sheet>
  );
}
