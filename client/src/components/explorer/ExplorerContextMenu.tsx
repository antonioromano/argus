import { useEffect, useRef } from 'react';
import { api } from '../../services/api.js';
import type { DirectoryEntry, GitFileStatusCode } from '@argus/shared';

export type ContextMenuAction =
  | { type: 'open' }
  | { type: 'copy-path' }
  | { type: 'copy-name' }
  | { type: 'reveal' }
  | { type: 'new-file'; parentPath: string }
  | { type: 'new-folder'; parentPath: string }
  | { type: 'rename' }
  | { type: 'delete' }
  | { type: 'show-diff' }
  | { type: 'stage' }
  | { type: 'unstage' }
  | { type: 'track' } // for untracked files
  | { type: 'revert-to-head' }
  | { type: 'add-to-gitignore' };

interface ExplorerContextMenuProps {
  entry: DirectoryEntry;
  gitStatus?: GitFileStatusCode;
  position: { x: number; y: number };
  sessionId: string;
  onAction: (action: ContextMenuAction) => void;
  onClose: () => void;
}

export function ExplorerContextMenu({
  entry,
  gitStatus,
  position,
  sessionId,
  onAction,
  onClose,
}: ExplorerContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Dismiss on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleItemClick = (action: ContextMenuAction) => {
    onAction(action);
    onClose();
  };

  const MenuItem = ({
    label,
    action,
    disabled = false,
  }: {
    label: string;
    action: ContextMenuAction;
    disabled?: boolean;
  }) => (
    <div
      onClick={() => {
        if (!disabled) handleItemClick(action);
      }}
      style={{
        padding: '5px 14px',
        fontSize: '12px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        color: 'var(--color-text)',
        borderRadius: '3px',
      }}
      onMouseEnter={(e) => {
        if (!disabled)
          (e.currentTarget as HTMLDivElement).style.background =
            'var(--color-accent-muted, rgba(74,144,226,0.15))';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = 'transparent';
      }}
    >
      {label}
    </div>
  );

  const Separator = () => (
    <div
      style={{
        height: '1px',
        background: 'var(--color-border-base, rgba(255,255,255,0.1))',
        margin: '3px 0',
      }}
    />
  );

  // For 'open path' in Finder we call the API directly
  const handleReveal = async () => {
    try {
      await api.openPath(sessionId, entry.path);
    } catch {
      // best-effort; caller can handle via onAction if needed
    }
    onClose();
  };

  const handleCopyPath = () => {
    navigator.clipboard.writeText(entry.path).catch(() => {});
    onClose();
  };

  const handleCopyName = () => {
    navigator.clipboard.writeText(entry.name).catch(() => {});
    onClose();
  };

  // Parent path: for files strip the filename, for dirs use the path itself
  const parentPath = entry.isFile
    ? entry.path.split('/').slice(0, -1).join('/') || '/'
    : entry.path;

  // Git status flags
  const isUntracked = gitStatus === '?';
  const isIgnored = gitStatus === '!!';
  // Files staged in index: A (new file added), R (renamed), C (copied)
  // Modified but not staged: M (working tree modified)
  // 'stage' action → git add; 'unstage' action → git restore --staged
  const isStagedInIndex = gitStatus === 'A' || gitStatus === 'R' || gitStatus === 'C';

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 1000,
        background: 'var(--color-bg-elevated, #1e1e1e)',
        border: '1px solid var(--color-border-base, rgba(255,255,255,0.12))',
        borderRadius: '6px',
        padding: '4px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        minWidth: '160px',
        userSelect: 'none',
      }}
    >
      {/* Basic file actions */}
      <div
        onClick={() => handleItemClick({ type: 'open' })}
        style={{ padding: '5px 14px', fontSize: '12px', cursor: 'pointer', color: 'var(--color-text)', borderRadius: '3px' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--color-accent-muted, rgba(74,144,226,0.15))'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      >
        Open
      </div>

      {/* Copy path/name — handled inline to call clipboard directly */}
      <div
        onClick={handleCopyPath}
        style={{ padding: '5px 14px', fontSize: '12px', cursor: 'pointer', color: 'var(--color-text)', borderRadius: '3px' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--color-accent-muted, rgba(74,144,226,0.15))'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      >
        Copy Path
      </div>

      <div
        onClick={handleCopyName}
        style={{ padding: '5px 14px', fontSize: '12px', cursor: 'pointer', color: 'var(--color-text)', borderRadius: '3px' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--color-accent-muted, rgba(74,144,226,0.15))'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      >
        Copy Filename
      </div>

      {/* Reveal in Finder — API call handled inline */}
      <div
        onClick={handleReveal}
        style={{ padding: '5px 14px', fontSize: '12px', cursor: 'pointer', color: 'var(--color-text)', borderRadius: '3px' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--color-accent-muted, rgba(74,144,226,0.15))'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      >
        Reveal in Finder
      </div>

      <Separator />

      <MenuItem label="New File" action={{ type: 'new-file', parentPath }} />
      <MenuItem label="New Folder" action={{ type: 'new-folder', parentPath }} />
      <MenuItem label="Rename" action={{ type: 'rename' }} />
      <MenuItem label="Delete" action={{ type: 'delete' }} />

      {/* Git section — hidden entirely for ignored files */}
      {!isIgnored && (
        <>
          <Separator />

          {/* Show Diff — files only */}
          {entry.isFile && (
            <MenuItem label="Show Diff" action={{ type: 'show-diff' }} />
          )}

          {/* Track — untracked files only */}
          {isUntracked && (
            <MenuItem label="Track" action={{ type: 'track' }} />
          )}

          {/* Stage / Unstage — tracked (non-untracked) files */}
          {!isUntracked && isStagedInIndex && (
            <MenuItem label="Unstage" action={{ type: 'unstage' }} />
          )}
          {!isUntracked && !isStagedInIndex && (
            <MenuItem label="Stage" action={{ type: 'stage' }} />
          )}

          {/* Revert to HEAD — tracked files only (not untracked) */}
          {!isUntracked && (
            <MenuItem label="Revert to HEAD" action={{ type: 'revert-to-head' }} />
          )}

          {/* Add to .gitignore — files only */}
          {entry.isFile && (
            <MenuItem label="Add to .gitignore" action={{ type: 'add-to-gitignore' }} />
          )}
        </>
      )}
    </div>
  );
}
