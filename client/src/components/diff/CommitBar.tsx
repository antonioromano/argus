import { useState } from 'react';
import { api } from '../../services/api.js';
import type { ChangelistEntry } from '@argus/shared';

interface CommitBarProps {
  sessionId: string;
  activeChangelist: ChangelistEntry;
  stagedFilesInList: string[]; // file paths with staged changes in active changelist
  onCommitSuccess: () => void; // called after a successful commit
}

export function CommitBar({ sessionId, activeChangelist, stagedFilesInList, onCommitSuccess }: CommitBarProps) {
  const [message, setMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCommit = stagedFilesInList.length > 0 && message.trim().length > 0 && !committing;

  const handleCommit = async () => {
    if (!canCommit) return;
    setCommitting(true);
    setError(null);
    try {
      const result = await api.commitWithFiles(sessionId, message.trim(), false, stagedFilesInList);
      if (result.success) {
        setMessage('');
        onCommitSuccess();
      } else {
        setError(result.error ?? 'Commit failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit failed');
    } finally {
      setCommitting(false);
    }
  };

  // Allow submitting the commit with Ctrl+Enter / Cmd+Enter from the textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleCommit();
    }
  };

  return (
    <div style={{ borderTop: '1px solid var(--color-border, rgba(255,255,255,0.12))', padding: '8px' }}>
      {/* Header row: changelist name + staged count */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontSize: '12px' }}>
        <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{activeChangelist.name}</span>
        <span style={{ color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
          {stagedFilesInList.length} staged
        </span>
      </div>

      {/* Commit message input */}
      <textarea
        value={message}
        onChange={e => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Commit message… (Ctrl+Enter to commit)"
        rows={2}
        style={{
          width: '100%', resize: 'vertical', boxSizing: 'border-box',
          background: 'var(--color-input-bg, rgba(255,255,255,0.05))',
          border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
          borderRadius: '4px', color: 'inherit', padding: '6px 8px',
          fontSize: '12px', fontFamily: 'inherit', outline: 'none',
        }}
      />

      {/* Inline error */}
      {error && (
        <div style={{ color: 'var(--color-error, #e74c3c)', fontSize: '11px', marginTop: '4px' }}>
          {error}
        </div>
      )}

      {/* Commit button */}
      <button
        onClick={handleCommit}
        disabled={!canCommit}
        style={{
          marginTop: '6px', width: '100%', padding: '6px',
          background: canCommit ? 'var(--color-accent, #4a90e2)' : 'var(--color-border, rgba(255,255,255,0.1))',
          color: canCommit ? '#fff' : 'var(--color-text-muted)',
          border: 'none', borderRadius: '4px', cursor: canCommit ? 'pointer' : 'default',
          fontSize: '12px', fontWeight: 500,
          opacity: committing ? 0.7 : 1,
          transition: 'background 0.15s, opacity 0.15s',
        }}
      >
        {committing ? 'Committing…' : 'Commit'}
      </button>
    </div>
  );
}
