import { ChevronUp, ChevronDown, ChevronsUpDown, Loader2 } from 'lucide-react';

interface DiffExpandRowProps {
  hiddenLines: number;
  onExpand: () => void;
  isLoading?: boolean;
  theme: 'dark' | 'light';
  /** Which arrows to show */
  position: 'top' | 'between' | 'bottom';
}

const COLORS = {
  dark: {
    bg: '#1e1f2a',
    bgHover: '#262736',
    text: '#8d909d',
    border: 'rgba(141,144,157,0.15)',
    icon: '#6366f1',
  },
  light: {
    bg: '#ebedf8',
    bgHover: '#dfe1f0',
    text: '#747780',
    border: 'rgba(116,119,128,0.15)',
    icon: '#6366f1',
  },
};

export function DiffExpandRow({ hiddenLines, onExpand, isLoading, theme, position }: DiffExpandRowProps) {
  const c = COLORS[theme];

  return (
    <div
      onClick={isLoading ? undefined : onExpand}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        padding: '2px 12px',
        background: c.bg,
        cursor: isLoading ? 'default' : 'pointer',
        userSelect: 'none',
        fontSize: '11px',
        fontFamily: 'var(--font-mono)',
        color: c.text,
        borderTop: `1px solid ${c.border}`,
        borderBottom: `1px solid ${c.border}`,
        opacity: isLoading ? 0.6 : 1,
        transition: 'background 0.15s',
        minHeight: '24px',
      }}
      onMouseEnter={e => { if (!isLoading) e.currentTarget.style.background = c.bgHover; }}
      onMouseLeave={e => { e.currentTarget.style.background = c.bg; }}
    >
      {isLoading ? (
        <Loader2 size={12} strokeWidth={2} style={{ animation: 'spin 1s linear infinite', color: c.icon }} />
      ) : position === 'top' ? (
        <ChevronUp size={12} strokeWidth={2} style={{ color: c.icon }} />
      ) : position === 'bottom' ? (
        <ChevronDown size={12} strokeWidth={2} style={{ color: c.icon }} />
      ) : (
        <ChevronsUpDown size={12} strokeWidth={2} style={{ color: c.icon }} />
      )}
      <span>
        {isLoading ? 'Loading…' : hiddenLines > 0 ? `${hiddenLines} lines hidden` : 'Load more context'}
      </span>
      {!isLoading && (position === 'top' ? (
        <ChevronUp size={12} strokeWidth={2} style={{ color: c.icon }} />
      ) : position === 'bottom' ? (
        <ChevronDown size={12} strokeWidth={2} style={{ color: c.icon }} />
      ) : (
        <ChevronsUpDown size={12} strokeWidth={2} style={{ color: c.icon }} />
      ))}
    </div>
  );
}
