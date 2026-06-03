import type { LucideIcon } from 'lucide-react';
import { SquareTerminal, Settings, Plus } from 'lucide-react';

export type MobileTab = 'sessions' | 'settings';

interface BottomNavProps {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
  onCreate: () => void;
}

const tabs: { id: MobileTab; icon: LucideIcon; label: string }[] = [
  { id: 'sessions', icon: SquareTerminal, label: 'Shells' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

/**
 * Three-slot mobile nav: Shells · + · Settings.
 * The centre + is an *action* (opens the Create sheet), not a routed tab —
 * Remote was removed because disabling the tunnel here disconnects the phone.
 */
export function BottomNav({ active, onChange, onCreate }: BottomNavProps) {
  return (
    <nav
      aria-label="Main navigation"
      style={{
        flexShrink: 0,
        background: 'var(--bg-1)',
        borderTop: '1px solid var(--line-2)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-around',
        zIndex: 'var(--z-sheet)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        boxSizing: 'content-box' as React.CSSProperties['boxSizing'],
        height: 64,
      }}
    >
      <TabButton tab={tabs[0]} active={active === tabs[0].id} onClick={() => onChange(tabs[0].id)} />

      <button
        onClick={onCreate}
        aria-label="New shell"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 48,
          height: 48,
          marginTop: 6,
          flexShrink: 0,
          borderRadius: '50%',
          border: 'none',
          background: 'var(--accent)',
          color: 'var(--fg-on-accent)',
          boxShadow: 'var(--shadow-pop)',
          cursor: 'pointer',
        }}
      >
        <Plus size={24} strokeWidth={2.2} />
      </button>

      <TabButton tab={tabs[1]} active={active === tabs[1].id} onClick={() => onChange(tabs[1].id)} />
    </nav>
  );
}

function TabButton({ tab, active, onClick }: { tab: { id: MobileTab; icon: LucideIcon; label: string }; active: boolean; onClick: () => void }) {
  const Icon = tab.icon;
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={tab.label}
      className="eyebrow"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        width: 72,
        height: 64,
        border: 'none',
        background: 'transparent',
        color: active ? 'var(--accent)' : 'var(--fg-2)',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <Icon size={20} strokeWidth={active ? 2 : 1.6} />
      {tab.label}
    </button>
  );
}
