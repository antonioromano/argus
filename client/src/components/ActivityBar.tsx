import { Terminal, GitBranch, FolderOpen, Settings } from 'lucide-react';
import type { AppTab } from './NavTabs.js';

interface ActivityBarProps {
  activeView: AppTab;
  onViewChange: (view: AppTab) => void;
  onOpenSettings: () => void;
}

const NAV_ITEMS = [
  { id: 'sessions' as AppTab, icon: Terminal, label: 'Sessions' },
  { id: 'git-diff' as AppTab, icon: GitBranch, label: 'Git Diff' },
  { id: 'explorer' as AppTab, icon: FolderOpen, label: 'Explorer' },
] as const;

export function ActivityBar({ activeView, onViewChange, onOpenSettings }: ActivityBarProps) {
  return (
    <div
      role="navigation"
      aria-label="Activity bar"
      style={{
        width: 'var(--activity-bar-width)',
        background: 'var(--color-bg-activity-bar)',
        borderRight: '0.5px solid var(--color-border-ghost)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 6,
        gap: 2,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
        const isActive = activeView === id;
        return (
          <button
            key={id}
            title={label}
            aria-label={label}
            aria-pressed={isActive}
            onClick={() => onViewChange(id)}
            className={!isActive ? 'hover-bg-surface' : ''}
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              background: isActive ? 'var(--color-accent-subtle)' : 'transparent',
              color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
              transition: 'background var(--transition-fast), color var(--transition-fast)',
              flexShrink: 0,
            }}
          >
            <Icon size={18} strokeWidth={1.75} />
          </button>
        );
      })}

      {/* Settings pinned to bottom */}
      <button
        title="Settings"
        aria-label="Settings"
        onClick={onOpenSettings}
        className="hover-bg-surface"
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          background: 'transparent',
          color: 'var(--color-text-muted)',
          transition: 'background var(--transition-fast), color var(--transition-fast)',
          marginTop: 'auto',
          marginBottom: 6,
          flexShrink: 0,
        }}
      >
        <Settings size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}
