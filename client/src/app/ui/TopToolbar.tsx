import { Search } from 'lucide-react';
import type { SessionInfo } from '@argus/shared';
import { TextInput, Tooltip } from '../../components/primitives/index.js';
import { STATUS_COLORS } from '../../constants/status.js';
import { filterSessions } from '../../utils/sessionFilter.js';

interface TopToolbarProps {
  filter?: string;
  onFilter?: (v: string) => void;
  sessions?: SessionInfo[];
  activeSessionId?: string;
  onSelectSession?: (id: string) => void;
}

export function TopToolbar({ filter, onFilter, sessions, activeSessionId, onSelectSession }: TopToolbarProps) {
  const matches = filterSessions(sessions ?? [], filter ?? '');

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && matches.length > 0) {
      e.preventDefault();
      onSelectSession?.(matches[0].id);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
      <div style={{ width: 260 }} onKeyDown={onKeyDown}>
        <TextInput
          icon={Search}
          placeholder="Filter shells"
          value={filter}
          onChange={onFilter}
        />
      </div>
      {matches.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {matches.map((s) => {
            const isActive = s.id === activeSessionId;
            return (
              <Tooltip key={s.id} content={`${s.name} · ${s.status}`}>
                <button
                  type="button"
                  onClick={() => onSelectSession?.(s.id)}
                  aria-label={`${s.name} · ${s.status}`}
                  aria-current={isActive || undefined}
                  disabled={!onSelectSession}
                  style={{
                    width: 14,
                    height: 12,
                    padding: 0,
                    border: 'none',
                    borderRadius: 0,
                    background: STATUS_COLORS[s.status],
                    opacity: isActive ? 1 : s.status === 'idle' ? 0.4 : 1,
                    boxShadow: isActive ? 'inset 0 0 0 2px var(--fg-0)' : 'none',
                    animation: s.status === 'waiting' ? 'argus-pulse-bar 2.4s ease-in-out infinite' : 'none',
                    cursor: onSelectSession ? 'pointer' : 'default',
                  }}
                />
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}
