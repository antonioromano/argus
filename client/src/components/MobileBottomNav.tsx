import { Terminal, GitBranch, FolderOpen, Plus, Settings } from 'lucide-react';
import type { AppTab } from './NavTabs.js';

interface MobileBottomNavProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onNewSession: () => void;
  onSettings: () => void;
}

interface NavItem {
  id: AppTab;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'sessions',  label: 'Sessions',  icon: Terminal },
  { id: 'git-diff',  label: 'Git Diff',  icon: GitBranch },
  { id: 'explorer',  label: 'Explorer',  icon: FolderOpen },
];

export function MobileBottomNav({ activeTab, onTabChange, onNewSession, onSettings }: MobileBottomNavProps) {
  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: '64px',
        background: 'var(--color-bg-surface)',
        borderTop: '1px solid var(--color-border-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        zIndex: 'var(--z-modal)' as unknown as number,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
      className="mobile-bottom-nav"
    >
      {/* Left two nav items */}
      {NAV_ITEMS.slice(0, 2).map((item) => {
        const isActive = activeTab === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              width: '64px',
              height: '100%',
              border: 'none',
              background: 'transparent',
              color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 'var(--text-xs)',
              fontWeight: isActive ? 600 : 400,
              fontFamily: 'var(--font-sans)',
              transition: 'color var(--transition-fast)',
              padding: 0,
            }}
          >
            <Icon size={22} strokeWidth={isActive ? 2 : 1.5} />
            {item.label}
          </button>
        );
      })}

      {/* Center FAB */}
      <button
        onClick={onNewSession}
        style={{
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          border: 'none',
          background: 'linear-gradient(135deg, #aec6ff 0%, #7aa2f7 100%)',
          color: '#002e6b',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(122,162,247,0.4)',
          fontSize: '22px',
          fontWeight: 300,
          transition: 'transform var(--transition-fast), box-shadow var(--transition-fast)',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.05)';
          e.currentTarget.style.boxShadow = '0 6px 16px rgba(122,162,247,0.5)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(122,162,247,0.4)';
        }}
        aria-label="New Session"
      >
        <Plus size={24} strokeWidth={2} />
      </button>

      {/* Right nav items */}
      {NAV_ITEMS.slice(2).map((item) => {
        const isActive = activeTab === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              width: '64px',
              height: '100%',
              border: 'none',
              background: 'transparent',
              color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 'var(--text-xs)',
              fontWeight: isActive ? 600 : 400,
              fontFamily: 'var(--font-sans)',
              transition: 'color var(--transition-fast)',
              padding: 0,
            }}
          >
            <Icon size={22} strokeWidth={isActive ? 2 : 1.5} />
            {item.label}
          </button>
        );
      })}

      {/* Settings */}
      <button
        onClick={onSettings}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '3px',
          width: '64px',
          height: '100%',
          border: 'none',
          background: 'transparent',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          fontSize: 'var(--text-xs)',
          fontWeight: 400,
          fontFamily: 'var(--font-sans)',
          transition: 'color var(--transition-fast)',
          padding: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
      >
        <Settings size={22} strokeWidth={1.5} />
        Settings
      </button>
    </nav>
  );
}
