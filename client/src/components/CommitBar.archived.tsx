import { useRef, useEffect } from 'react';
import { GitCommit, RotateCcw, X, AlertCircle, Loader2, ArrowUpFromLine } from 'lucide-react';
import type { UseCommitModeResult } from '../hooks/useCommitMode.js';
import type { FileMeta } from '../hooks/useCommitMode.js';
import { MacCommitBar } from './mac/MacCommitBar.js';

const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('electron');

interface CommitBarProps {
  sessionId: string;
  fileMetas: FileMeta[];
  untrackedFiles: string[];
  commitModeResult: UseCommitModeResult;
  onClose: () => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  // Used to detect "untracked-only" selection to disable Discard
  hasOnlyUntrackedSelected: boolean;
  onRefresh?: () => void;
  onCommitSuccess?: () => void;
}

export function CommitBar(props: CommitBarProps) {
  if (isElectron) return <MacCommitBar {...props} />;

  const {
    sessionId,
    fileMetas,
    untrackedFiles,
    commitModeResult,
    onClose: _onClose,
    onSelectAll,
    onClearAll,
    hasOnlyUntrackedSelected,
    onRefresh,
    onCommitSuccess,
  } = props;

  const { commitMode, actions, selectedLineCount, selectedFileCount, canCommit } = commitModeResult;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isLoading = commitMode.status === 'staging' || commitMode.status === 'committing';
  const statusLabel = commitMode.status === 'staging' ? 'Staging…' : commitMode.status === 'committing' ? 'Committing…' : null;

  const handleCommitAndPush = async () => {
    const success = await actions.stageCommitAndPush(sessionId, fileMetas, untrackedFiles);
    if (success) onCommitSuccess?.();
    onRefresh?.();
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 20;
    const maxHeight = lineHeight * 3 + 16; // 3 lines + padding
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
  }, [commitMode.commitMessage]);

  const handleCommit = async () => {
    const success = await actions.stageAndCommit(sessionId, fileMetas, untrackedFiles);
    if (success) onCommitSuccess?.();
    onRefresh?.();
  };

  const handleDiscard = async () => {
    await actions.discardSelected(sessionId, fileMetas);
    onRefresh?.();
  };

  const handleUndo = async () => {
    await actions.undoDiscard(sessionId);
    onRefresh?.();
  };

  const summaryText = selectedLineCount > 0
    ? `${selectedFileCount} file${selectedFileCount !== 1 ? 's' : ''} · ${selectedLineCount} line${selectedLineCount !== 1 ? 's' : ''}`
    : selectedFileCount > 0
    ? `${selectedFileCount} file${selectedFileCount !== 1 ? 's' : ''}`
    : 'Nothing selected';

  return (
    <div
      className="commit-bar"
      style={{
        borderTop: '1px solid var(--color-border-base)',
        background: 'var(--color-bg-elevated)',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Error banner */}
      {commitMode.errorMessage && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            padding: '8px 12px',
            background: 'var(--color-error-subtle)',
            borderBottom: '1px solid var(--color-border-base)',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-error)',
          }}
        >
          <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
          <pre
            style={{
              flex: 1,
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              lineHeight: 1.5,
            }}
          >
            {commitMode.errorMessage}
          </pre>
          <button
            onClick={actions.dismissError}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-error)',
              padding: 0,
              flexShrink: 0,
              display: 'inline-flex',
            }}
            aria-label="Dismiss error"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Stale diff warning */}
      {commitMode.hasStaleDiff && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            background: 'rgba(255, 180, 0, 0.08)',
            borderBottom: '1px solid var(--color-border-base)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <AlertCircle size={12} style={{ color: '#f0a020', flexShrink: 0 }} />
          <span>The diff has changed since you started selecting. Review your selection.</span>
          <button
            onClick={actions.dismissStaleDiff}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, display: 'inline-flex' }}
            aria-label="Dismiss warning"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Undo toast */}
      {commitMode.undoEntry && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            background: 'var(--color-bg-surface)',
            borderBottom: '1px solid var(--color-border-base)',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <RotateCcw size={12} style={{ flexShrink: 0 }} />
          <span>{commitMode.undoEntry.description} — <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Resets on page reload</span></span>
          <button
            onClick={handleUndo}
            style={{
              marginLeft: 'auto',
              background: 'var(--color-accent-subtle)',
              border: '1px solid var(--color-accent)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-accent)',
              cursor: 'pointer',
              padding: '2px 10px',
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
            }}
          >
            Undo
          </button>
          <button
            onClick={actions.dismissUndoEntry}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, display: 'inline-flex' }}
            aria-label="Dismiss undo"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Summary row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 12px',
          borderBottom: '1px solid var(--color-border-base)',
        }}
      >
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: selectedFileCount > 0 ? 'var(--color-accent)' : 'var(--color-text-muted)',
            fontWeight: 500,
          }}
        >
          {summaryText}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
          <button
            onClick={onSelectAll}
            style={smallBtnStyle}
            disabled={isLoading}
          >
            Select all
          </button>
          <button
            onClick={onClearAll}
            style={smallBtnStyle}
            disabled={isLoading || selectedFileCount === 0}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Commit message + actions row */}
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <textarea
          ref={textareaRef}
          value={commitMode.commitMessage}
          onChange={e => actions.setCommitMessage(e.target.value)}
          placeholder="Commit message…"
          disabled={isLoading}
          rows={1}
          style={{
            width: '100%',
            background: 'var(--color-bg-input, var(--color-bg-surface))',
            border: '1px solid var(--color-border-base)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-base)',
            fontSize: 'var(--text-sm)',
            padding: '6px 8px',
            resize: 'none',
            outline: 'none',
            boxSizing: 'border-box',
            overflowY: 'auto',
            lineHeight: '20px',
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canCommit) {
              e.preventDefault();
              handleCommit();
            }
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Amend checkbox */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              cursor: commitMode.isFirstCommit ? 'not-allowed' : 'pointer',
              userSelect: 'none',
            }}
            title={commitMode.isFirstCommit ? 'No previous commit to amend' : 'Amending rewrites history. Force push required if already pushed.'}
          >
            <input
              type="checkbox"
              checked={commitMode.isAmend}
              onChange={e => actions.setIsAmend(e.target.checked)}
              disabled={commitMode.isFirstCommit || isLoading}
              style={{ cursor: commitMode.isFirstCommit ? 'not-allowed' : 'pointer', accentColor: 'var(--color-accent)' }}
            />
            Amend
          </label>

          {/* Status label */}
          {statusLabel && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
              {statusLabel}
            </span>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
            {/* Discard button */}
            <button
              onClick={handleDiscard}
              disabled={isLoading || selectedFileCount === 0 || hasOnlyUntrackedSelected}
              title={hasOnlyUntrackedSelected ? 'Cannot discard untracked files' : undefined}
              style={{
                ...actionBtnStyle,
                color: 'var(--color-error)',
                background: 'transparent',
                borderColor: 'var(--color-error)',
                opacity: (isLoading || selectedFileCount === 0 || hasOnlyUntrackedSelected) ? 0.4 : 1,
                cursor: (isLoading || selectedFileCount === 0 || hasOnlyUntrackedSelected) ? 'not-allowed' : 'pointer',
              }}
            >
              Discard
            </button>

            {/* Commit button */}
            <button
              onClick={handleCommit}
              disabled={!canCommit || isLoading}
              style={{
                ...actionBtnStyle,
                color: '#fff',
                background: canCommit && !isLoading ? 'var(--color-accent)' : 'var(--color-text-muted)',
                borderColor: 'transparent',
                opacity: (!canCommit || isLoading) ? 0.5 : 1,
                cursor: (!canCommit || isLoading) ? 'not-allowed' : 'pointer',
              }}
            >
              <GitCommit size={12} strokeWidth={2} />
              Commit
            </button>

            {/* Commit & Push button */}
            <button
              onClick={handleCommitAndPush}
              disabled={!canCommit || isLoading}
              title="Commit and push to remote"
              style={{
                ...actionBtnStyle,
                color: '#fff',
                background: canCommit && !isLoading ? 'var(--color-accent)' : 'var(--color-text-muted)',
                borderColor: 'transparent',
                opacity: (!canCommit || isLoading) ? 0.5 : 1,
                cursor: (!canCommit || isLoading) ? 'not-allowed' : 'pointer',
              }}
            >
              <ArrowUpFromLine size={12} strokeWidth={2} />
              Commit &amp; Push
            </button>
          </div>
        </div>
      </div>

      {/* Spin keyframe injected inline */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const smallBtnStyle: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: 'var(--text-xs)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
};

const actionBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '4px 12px',
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  border: '1px solid',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  transition: 'opacity var(--transition-fast)',
};
