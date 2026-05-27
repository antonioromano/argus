import type { LucideIcon } from 'lucide-react';
import { Terminal, GitBranch, Wifi } from 'lucide-react';

export type MobileTab = 'sessions' | 'diff' | 'remote';

interface BottomNavProps {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
}

const tabs: { id: MobileTab; icon: LucideIcon; label: string }[] = [
  { id: 'sessions', icon: Terminal,   label: 'Sessions' },
  { id: 'diff',     icon: GitBranch,  label: 'Diff' },
  { id: 'remote',   icon: Wifi,       label: 'Remote' },
];

export function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav
      aria-label="Main navigation"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 64,
        background: 'var(--bg-1)',
        borderTop: '1px solid var(--line-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        zIndex: 1000,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {tabs.map((t) => {
        const Icon = t.icon;
        const sel = active === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            aria-current={sel ? 'page' : undefined}
            aria-label={t.label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              width: 64,
              height: '100%',
              border: 'none',
              background: 'transparent',
              color: sel ? 'var(--accent)' : 'var(--fg-2)',
              cursor: 'pointer',
              padding: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-micro)',
              letterSpacing: 'var(--tracking-eye)',
              textTransform: 'uppercase',
            }}
          >
            <Icon size={20} strokeWidth={sel ? 2 : 1.6} />
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
