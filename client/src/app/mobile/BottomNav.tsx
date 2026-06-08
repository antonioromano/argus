import type { LucideIcon } from 'lucide-react';
import { SquareTerminal, Settings, Plus } from 'lucide-react';

export type MobileTab = 'sessions' | 'settings';

interface BottomNavProps {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
  onCreate: () => void;
  doneCount?: number;
  waitingCount?: number;
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
export function BottomNav({ active, onChange, onCreate, doneCount = 0, waitingCount = 0 }: BottomNavProps) {
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
      <TabButton tab={tabs[0]} active={active === tabs[0].id} onClick={() => onChange(tabs[0].id)} doneCount={doneCount} waitingCount={waitingCount} />

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

function NavBadge({ count, type, shiftLeft }: { count: number; type: 'done' | 'waiting'; shiftLeft?: boolean }) {
  if (count <= 0) return null;
  const bg = type === 'done' ? 'var(--status-done)' : 'var(--status-waiting)';
  const textColor = type === 'done' ? '#002a14' : '#1a0f00';
  return (
    <span
      aria-label={`${count} ${type}`}
      style={{
        position: 'absolute',
        top: -3,
        right: shiftLeft ? 8 : -4,
        minWidth: 16,
        height: 16,
        borderRadius: 999,
        background: bg,
        color: textColor,
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 3px',
        border: '1.5px solid var(--bg-1)',
        lineHeight: 1,
        animation: type === 'waiting' ? 'argus-pulse-dot 2400ms ease-in-out infinite' : undefined,
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function TabButton({ tab, active, onClick, doneCount = 0, waitingCount = 0 }: { tab: { id: MobileTab; icon: LucideIcon; label: string }; active: boolean; onClick: () => void; doneCount?: number; waitingCount?: number }) {
  const Icon = tab.icon;
  const showBadges = tab.id === 'sessions';
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
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={20} strokeWidth={active ? 2 : 1.6} />
        {showBadges && (
          <>
            <NavBadge count={doneCount} type="done" shiftLeft={waitingCount > 0} />
            <NavBadge count={waitingCount} type="waiting" />
          </>
        )}
      </span>
      {tab.label}
    </button>
  );
}
