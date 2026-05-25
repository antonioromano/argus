import { ChevronUp, RefreshCw, Eye, EyeOff } from 'lucide-react';

interface MacExplorerToolbarProps {
  currentPath: string;
  onNavigateUp: () => void;
  onRefresh: () => void;
  onToggleHidden: () => void;
  showHidden: boolean;
  canNavigateUp: boolean;
}

export function MacExplorerToolbar({ currentPath, onNavigateUp, onRefresh, onToggleHidden, showHidden, canNavigateUp }: MacExplorerToolbarProps) {
  return (
    <div style={{
      height: 36,
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '0 10px',
      background: 'var(--color-bg-elevated)',
      borderBottom: '1px solid var(--color-border-base)',
      flexShrink: 0,
    }}>
      {/* Navigate up */}
      <button
        onClick={onNavigateUp}
        disabled={!canNavigateUp}
        title="Navigate up"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28,
          background: 'transparent', border: 'none', borderRadius: 5,
          color: canNavigateUp ? 'var(--color-text-muted)' : 'var(--color-border-base)',
          cursor: canNavigateUp ? 'pointer' : 'default',
          flexShrink: 0,
        }}
      >
        <ChevronUp size={14} strokeWidth={2} />
      </button>

      {/* Path display */}
      <span
        title={currentPath}
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          direction: 'rtl',
          textAlign: 'left',
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-text-muted)',
          userSelect: 'none',
        }}
      >
        {currentPath || '—'}
      </span>

      {/* Toggle hidden files */}
      <button
        onClick={onToggleHidden}
        title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28,
          background: 'transparent', border: 'none', borderRadius: 5,
          color: showHidden ? 'var(--color-accent)' : 'var(--color-text-muted)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {showHidden ? <Eye size={14} strokeWidth={2} /> : <EyeOff size={14} strokeWidth={2} />}
      </button>

      {/* Refresh */}
      <button
        onClick={onRefresh}
        title="Refresh"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28,
          background: 'transparent', border: 'none', borderRadius: 5,
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <RefreshCw size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
