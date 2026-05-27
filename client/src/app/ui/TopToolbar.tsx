import { Search } from 'lucide-react';
import type { SessionInfo } from '@argus/shared';
import { TextInput } from '../../components/primitives/index.js';
import { STATUS_COLORS } from '../../constants/status.js';

interface TopToolbarProps {
  filter?: string;
  onFilter?: (v: string) => void;
  sessions?: SessionInfo[];
  onSelectSession?: (id: string) => void;
}

export function TopToolbar({ filter, onFilter, sessions, onSelectSession }: TopToolbarProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
      <div style={{ width: 260 }} data-shortcut-host="filter">
        <TextInput
          icon={Search}
          placeholder="Filter sessions, folders, agents…"
          suffix="⌘F"
          value={filter}
          onChange={onFilter}
        />
      </div>
      {sessions && sessions.length > 0 && (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 1 }}
          title={`${sessions.filter((s) => s.status === 'waiting').length} waiting · ${sessions.filter((s) => s.status === 'running').length} running`}
        >
          {sessions.map((s) => (
            <span
              key={s.id}
              title={`${s.name} · ${s.status}`}
              onClick={() => onSelectSession?.(s.id)}
              style={{
                width: 14,
                height: 12,
                background: STATUS_COLORS[s.status],
                opacity: s.status === 'idle' ? 0.4 : 1,
                animation: s.status === 'waiting' ? 'argus-pulse-bar 2.4s ease-in-out infinite' : 'none',
                cursor: onSelectSession ? 'pointer' : 'default',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
