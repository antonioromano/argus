import { RefreshCw, WrapText, ArrowDown, GitBranch } from 'lucide-react';
import { MacSelect } from './primitives/index.js';
import { MacInput } from './primitives/index.js';

interface MacDiffToolbarProps {
  /** Branch list for the branch selector. */
  branches: string[];
  /** Currently checked-out branch. */
  currentBranch: string;
  /** Called when the user selects a different branch. */
  onBranchChange: (branch: string) => void;
  /** Whether branch operations are in-progress (disables controls). */
  branchLoading?: boolean;
  /** Number of commits behind remote (shows badge when > 0). */
  behindCount?: number;
  /** Called when pull button is clicked. */
  onPull?: () => Promise<void>;
  /** Called when branch management button is clicked. */
  onOpenBranchSheet?: () => void;
  /** Current file-search query. */
  searchQuery: string;
  /** Called when the search query changes. */
  onSearchChange: (query: string) => void;
  /** Whether word-wrap is enabled. */
  wordWrap: boolean;
  /** Toggle word-wrap on/off. */
  onToggleWordWrap: () => void;
  /** Whether a refresh is in progress (spins the icon). */
  isLoading: boolean;
  /** Called when the refresh button is clicked. */
  onRefresh: () => void;
}

const iconBtnStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  background: active ? 'var(--color-accent-subtle)' : 'transparent',
  border: 'none',
  borderRadius: 5,
  color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
  cursor: 'pointer',
  flexShrink: 0,
  transition: 'background 0.12s ease, color 0.12s ease',
});

export function MacDiffToolbar({
  branches,
  currentBranch,
  onBranchChange,
  branchLoading = false,
  behindCount,
  onPull,
  onOpenBranchSheet,
  searchQuery,
  onSearchChange,
  wordWrap,
  onToggleWordWrap,
  isLoading,
  onRefresh,
}: MacDiffToolbarProps) {
  const branchOptions = branches.map(b => ({ value: b, label: b }));
  // Ensure the current branch is always present even if not in the list (e.g. detached HEAD)
  if (currentBranch && !branches.includes(currentBranch)) {
    branchOptions.unshift({ value: currentBranch, label: currentBranch });
  }

  return (
    <>
      {/* Spin keyframe — injected once alongside the component */}
      <style>{`@keyframes mac-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 36,
          padding: '0 8px',
          background: 'var(--color-bg-elevated)',
          borderBottom: '1px solid var(--color-border-base)',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        {/* Branch selector */}
        {branchOptions.length > 0 && (
          <div style={{ flexShrink: 0, maxWidth: 160 }}>
            <MacSelect
              options={branchOptions}
              value={currentBranch}
              onChange={onBranchChange}
              disabled={branchLoading}
            />
          </div>
        )}

        {/* Pull button (with behind-count badge) */}
        {onPull && (
          <button
            style={{ ...iconBtnStyle(false), position: 'relative' }}
            onClick={onPull}
            disabled={branchLoading}
            title={behindCount ? `Pull (${behindCount} commit${behindCount !== 1 ? 's' : ''} behind)` : 'Pull'}
          >
            <ArrowDown size={14} strokeWidth={1.75} />
            {!!behindCount && behindCount > 0 && (
              <span style={{
                position: 'absolute',
                top: 3,
                right: 3,
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: 'var(--color-accent)',
                pointerEvents: 'none',
              }} />
            )}
          </button>
        )}

        {/* Branch management button */}
        {onOpenBranchSheet && (
          <button
            style={iconBtnStyle(false)}
            onClick={onOpenBranchSheet}
            disabled={branchLoading}
            title="Create or switch branch"
          >
            <GitBranch size={14} strokeWidth={1.75} />
          </button>
        )}

        {/* File search input (stretches to fill remaining space) */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <MacInput
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Filter files..."
            type="search"
          />
        </div>

        {/* Word-wrap toggle */}
        <button
          style={iconBtnStyle(wordWrap)}
          onClick={onToggleWordWrap}
          title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
        >
          <WrapText size={14} strokeWidth={1.75} />
        </button>

        {/* Refresh button */}
        <button
          style={iconBtnStyle(false)}
          onClick={onRefresh}
          disabled={isLoading}
          title="Refresh diff"
        >
          <RefreshCw
            size={14}
            strokeWidth={1.75}
            style={{
              animation: isLoading ? 'mac-spin 1s linear infinite' : 'none',
            }}
          />
        </button>
      </div>
    </>
  );
}
