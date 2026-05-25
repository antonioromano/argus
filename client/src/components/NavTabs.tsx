import { Terminal, GitBranch, FolderOpen } from 'lucide-react';

export type AppTab = 'sessions' | 'git-diff' | 'explorer';

interface TabConfig {
  id: AppTab;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  disabled?: boolean;
}

const TABS: TabConfig[] = [
  { id: 'sessions',  label: 'Terminal Sessions', icon: Terminal },
  { id: 'git-diff',  label: 'Git Diff',          icon: GitBranch },
  { id: 'explorer',  label: 'Explorer',           icon: FolderOpen },
];

interface NavTabsProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  sessionCount?: number;
  waitingCount?: number;
}

export function NavTabs({ activeTab, onTabChange, sessionCount, waitingCount }: NavTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Main navigation"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: 'var(--nav-tabs-height)',
        background: 'var(--color-bg-deepest)',
        borderBottom: 'none',
        flexShrink: 0,
        overflowX: 'auto',
      }}
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.icon;

        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            id={`tab-${tab.id}`}
            onClick={() => !tab.disabled && onTabChange(tab.id)}
            disabled={tab.disabled}
            className={!tab.disabled && !isActive ? 'hover-bg-surface' : ''}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0 16px',
              height: '100%',
              border: 'none',
              borderBottom: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
              background: isActive ? 'var(--color-surface-highest)' : 'transparent',
              color: tab.disabled
                ? 'var(--color-text-muted)'
                : isActive
                  ? 'var(--color-accent)'
                  : 'var(--color-text-secondary)',
              cursor: tab.disabled ? 'not-allowed' : 'pointer',
              opacity: tab.disabled ? 0.5 : 1,
              fontSize: 'var(--text-base)',
              fontWeight: isActive ? 600 : 400,
              fontFamily: 'var(--font-sans)',
              transition: 'background var(--transition-fast), color var(--transition-fast)',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            <Icon size={14} strokeWidth={1.75} />
            {tab.label}
            {tab.id === 'sessions' && sessionCount !== undefined && sessionCount > 0 && (
              <span
                style={{
                  fontSize: 'var(--text-xs)',
                  background: 'var(--color-accent-subtle)',
                  color: 'var(--color-accent)',
                  padding: '1px 5px',
                  borderRadius: 'var(--radius-pill)',
                  fontWeight: 600,
                }}
              >
                {sessionCount}
              </span>
            )}
            {tab.id === 'sessions' && waitingCount !== undefined && waitingCount > 0 && (
              <span
                style={{
                  fontSize: 'var(--text-xs)',
                  background: 'rgba(245, 158, 11, 0.15)',
                  color: 'var(--color-status-waiting)',
                  padding: '1px 5px',
                  borderRadius: 'var(--radius-pill)',
                  fontWeight: 600,
                }}
              >
                {waitingCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
