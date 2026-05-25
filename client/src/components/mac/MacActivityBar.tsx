import { useState } from 'react';
import { Terminal, GitBranch, FolderOpen } from 'lucide-react';
import type { AppTab } from '../NavTabs.js';

interface MacActivityBarProps {
  activeView: AppTab;
  onViewChange: (view: AppTab) => void;
}

const NAV_ITEMS = [
  { id: 'sessions' as AppTab, icon: Terminal,   label: 'Sessions' },
  { id: 'git-diff' as AppTab, icon: GitBranch,  label: 'Diff'     },
  { id: 'explorer' as AppTab, icon: FolderOpen, label: 'Files'    },
] as const;

/**
 * macOS-style activity bar for the Electron desktop layout.
 * Wider than the browser ActivityBar (68 px vs 48 px), with icon+label
 * stacked vertically and a vibrancy-style backdrop blur.
 */
export function MacActivityBar({ activeView, onViewChange }: MacActivityBarProps) {
  return (
    <div
      role="navigation"
      aria-label="Activity bar"
      style={{
        width: 'var(--activity-bar-width, 68px)',
        height: '100%',
        background: 'var(--color-bg-activity-bar)',
        backdropFilter: 'blur(20px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.6)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 12,
        gap: 2,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
        <MacActivityItem
          key={id}
          id={id}
          icon={Icon}
          label={label}
          isActive={activeView === id}
          onSelect={onViewChange}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal item component — keeps hover state local, avoids re-rendering the
// entire bar on every mouse-enter / mouse-leave.
// ---------------------------------------------------------------------------

interface MacActivityItemProps {
  id: AppTab;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  isActive: boolean;
  onSelect: (id: AppTab) => void;
}

function MacActivityItem({ id, icon: Icon, label, isActive, onSelect }: MacActivityItemProps) {
  const [hovered, setHovered] = useState(false);

  const bgColor = isActive
    ? 'var(--color-accent-subtle)'
    : hovered
      ? 'rgba(0, 0, 0, 0.05)'
      : 'transparent';

  const fgColor = isActive
    ? 'var(--color-accent)'
    : 'var(--color-text-muted)';

  return (
    <button
      aria-label={label}
      aria-pressed={isActive}
      onClick={() => onSelect(id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 56,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        padding: '6px 0',
        borderRadius: 8,
        cursor: 'pointer',
        border: 'none',
        background: bgColor,
        color: fgColor,
        transition: 'background var(--transition-fast), color var(--transition-fast)',
        flexShrink: 0,
      }}
    >
      <Icon size={20} strokeWidth={1.75} />
      <span
        style={{
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          fontFamily: 'var(--font-sans)',
          lineHeight: 1,
        }}
      >
        {label}
      </span>
    </button>
  );
}
