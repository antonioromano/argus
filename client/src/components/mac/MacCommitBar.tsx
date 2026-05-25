import { MacTextarea } from './primitives/index.js';
import type { UseCommitModeResult } from '../../hooks/useCommitMode.js';
import type { FileMeta } from '../../hooks/useCommitMode.js';

interface CommitBarProps {
  sessionId: string;
  fileMetas: FileMeta[];
  untrackedFiles: string[];
  commitModeResult: UseCommitModeResult;
  onClose: () => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  hasOnlyUntrackedSelected: boolean;
  onRefresh?: () => void;
  onCommitSuccess?: () => void;
}

export function MacCommitBar({
  sessionId,
  fileMetas,
  untrackedFiles,
  commitModeResult,
  onClose: _onClose,
  onSelectAll: _onSelectAll,
  onClearAll: _onClearAll,
  hasOnlyUntrackedSelected,
  onRefresh,
  onCommitSuccess,
}: CommitBarProps) {
  const { commitMode, actions, selectedLineCount, selectedFileCount, canCommit } = commitModeResult;

  const isLoading = commitMode.status === 'staging' || commitMode.status === 'committing';

  const handleCommit = async () => {
    const success = await actions.stageAndCommit(sessionId, fileMetas, untrackedFiles);
    if (success) onCommitSuccess?.();
    onRefresh?.();
  };

  const handleCommitAndPush = async () => {
    const success = await actions.stageCommitAndPush(sessionId, fileMetas, untrackedFiles);
    if (success) onCommitSuccess?.();
    onRefresh?.();
  };

  const handleDiscard = async () => {
    await actions.discardSelected(sessionId, fileMetas);
    onRefresh?.();
  };

  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        background: 'var(--color-bg-elevated)',
        borderTop: '1px solid var(--color-border-base)',
        padding: '10px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Top row: stats pill + discard button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {selectedFileCount} file{selectedFileCount !== 1 ? 's' : ''}, {selectedLineCount} line{selectedLineCount !== 1 ? 's' : ''}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {!hasOnlyUntrackedSelected && (
            <button
              onClick={handleDiscard}
              disabled={isLoading || selectedFileCount === 0}
              style={{
                padding: '3px 10px',
                fontSize: 12,
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--color-text-muted)',
                cursor: (isLoading || selectedFileCount === 0) ? 'not-allowed' : 'pointer',
                opacity: (isLoading || selectedFileCount === 0) ? 0.4 : 1,
                fontFamily: 'var(--font-sans)',
              }}
            >
              Discard ↺
            </button>
          )}
        </div>
      </div>

      {/* Commit message textarea */}
      <MacTextarea
        value={commitMode.commitMessage}
        onChange={msg => actions.setCommitMessage(msg)}
        placeholder="Commit message…"
        disabled={isLoading}
        rows={1}
        maxRows={3}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canCommit) {
            e.preventDefault();
            handleCommit();
          }
        }}
      />

      {/* Error display */}
      {commitMode.errorMessage && (
        <div style={{ color: 'var(--color-error)', fontSize: 11 }}>
          {commitMode.errorMessage}
        </div>
      )}

      {/* Bottom row: Cancel + Commit + Push */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
        <button
          onClick={_onClose}
          style={{
            padding: '5px 12px',
            fontSize: 13,
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 6,
            background: 'transparent',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
        >
          Cancel
        </button>

        <button
          onClick={handleCommit}
          disabled={!canCommit || isLoading}
          style={{
            padding: '5px 14px',
            fontSize: 13,
            border: 'none',
            borderRadius: 6,
            background: 'var(--color-accent)',
            color: '#fff',
            cursor: (!canCommit || isLoading) ? 'not-allowed' : 'pointer',
            opacity: (!canCommit || isLoading) ? 0.5 : 1,
            fontFamily: 'var(--font-sans)',
            fontWeight: 500,
          }}
        >
          {isLoading ? 'Commit…' : 'Commit'}
        </button>

        <button
          onClick={handleCommitAndPush}
          disabled={!canCommit || isLoading}
          style={{
            padding: '5px 14px',
            fontSize: 13,
            border: 'none',
            borderRadius: 6,
            background: 'var(--color-accent)',
            color: '#fff',
            cursor: (!canCommit || isLoading) ? 'not-allowed' : 'pointer',
            opacity: (!canCommit || isLoading) ? 0.5 : 1,
            fontFamily: 'var(--font-sans)',
            fontWeight: 500,
          }}
        >
          {isLoading ? '↑ Push…' : '↑ Push'}
        </button>
      </div>
    </div>
  );
}
