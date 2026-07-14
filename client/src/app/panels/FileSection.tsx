import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Check, Minus, Plus, EyeOff, RotateCcw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useDiffInlineEdit } from '../../hooks/useDiffInlineEdit.js';
import type { ChangeBlock } from '../overlays/diff/changeBlocks.js';
import type { FileModel } from '../overlays/diff/diffModel.js';
import { RevertConfirmCard } from '../overlays/diff/ConfirmRevert.js';
import { useSkipRevertConfirm } from '../../hooks/useSkipRevertConfirm.js';
import { DiffViewer } from './DiffViewer.js';

export interface FileSectionProps {
  file: FileModel;
  sessionId: string;
  folderPath: string;
  /** Open a file in the Monaco editor at a line (cmd+click go-to-def). */
  onOpenInEditor?: (filePath: string, line?: number) => void;
  mode: 'split' | 'unified';
  /** True when this file is the scroll-active one (drives header highlight). */
  active: boolean;
  /** Register the section root element with the parent for scroll-spy + scroll-to. */
  registerRef: (id: string, el: HTMLElement | null) => void;
  /** Block-level commit selection — only wired for unstaged files. */
  isChecked: (filePath: string, hash: string) => boolean;
  onToggleBlock: (block: ChangeBlock) => void;
  onRevertBlock: (block: ChangeBlock) => Promise<void> | void;
  /** Start collapsed (Unit 5 auto-collapses very large files). */
  defaultCollapsed?: boolean;
  /** Render the heavy diff body. False = off-screen placeholder (Unit 5). */
  renderBody?: boolean;
  /** Estimated body height (px) used for the placeholder when renderBody is false. */
  estimatedBodyHeight?: number;

  // ── Header actions (source-aware; parent passes only the relevant ones) ──
  /** Unstaged: state of the file-wide "accept" (check all blocks) toggle. */
  acceptState?: 'none' | 'partial' | 'all';
  acceptDisabled?: boolean;
  onAccept?: () => void;
  /** Unstaged: discard all changes in the file. */
  onRollback?: () => Promise<void> | void;
  rollbackBusy?: boolean;
  /** Untracked: stage (track) / add to .gitignore. */
  onStage?: () => void;
  stageBusy?: boolean;
  onIgnore?: () => void;
  ignoreBusy?: boolean;
  /** Staged: move back to unstaged. */
  onUnstage?: () => void;
  unstageBusy?: boolean;
}

function HeaderChip({
  label,
  icon: Icon,
  tone = 'muted',
  busy = false,
  active = false,
  partial = false,
  title,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  tone?: 'accent' | 'muted' | 'danger';
  busy?: boolean;
  active?: boolean;
  partial?: boolean;
  title: string;
  onClick: () => void;
}) {
  const color = busy
    ? 'var(--fg-3)'
    : tone === 'accent'
      ? 'var(--accent)'
      : tone === 'danger'
        ? 'var(--danger)'
        : 'var(--fg-2)';
  return (
    <span
      role="button"
      tabIndex={0}
      title={title}
      onClick={() => { if (!busy) onClick(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!busy) onClick();
        }
      }}
      style={{
        cursor: busy ? 'wait' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: '2px 6px',
        borderRadius: 'var(--r-2)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--line-3)'}`,
        background: active ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent',
        color,
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-micro)',
      }}
    >
      {partial ? <Minus size={10} strokeWidth={2.5} /> : <Icon size={10} strokeWidth={2} />}
      {label}
    </span>
  );
}

export function FileSection({
  file,
  sessionId,
  folderPath,
  onOpenInEditor,
  mode,
  active,
  registerRef,
  isChecked,
  onToggleBlock,
  onRevertBlock,
  defaultCollapsed = false,
  renderBody = true,
  estimatedBodyHeight,
  acceptState = 'none',
  acceptDisabled = false,
  onAccept,
  onRollback,
  rollbackBusy = false,
  onStage,
  stageBusy = false,
  onIgnore,
  ignoreBusy = false,
  onUnstage,
  unstageBusy = false,
}: FileSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [pendingRollback, setPendingRollback] = useState(false);
  const { skip: skipConfirm, toggle: toggleSkipConfirm } = useSkipRevertConfirm();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    registerRef(file.id, rootRef.current);
    return () => registerRef(file.id, null);
  }, [file.id, registerRef]);

  const isUnstaged = file.source === 'unstaged';
  const editTargetPath =
    isUnstaged && !file.isDeleted ? `${folderPath.replace(/\/$/, '')}/${file.path}` : null;
  // Absolute path for symbol navigation (all sources; the server resolves the
  // owning session by directory, so even a deleted file's path works).
  const navFilePath = `${folderPath.replace(/\/$/, '')}/${file.path}`;

  const bodyMounted = !collapsed && renderBody;
  const inlineEdit = useDiffInlineEdit({
    sessionId,
    absolutePath: editTargetPath,
    enabled: bodyMounted && !!editTargetPath,
  });

  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);

  const requestRollback = useCallback(() => {
    if (skipConfirm) void onRollback?.();
    else setPendingRollback(true);
  }, [skipConfirm, onRollback]);

  const confirmRollback = useCallback(async () => {
    await onRollback?.();
    setPendingRollback(false);
  }, [onRollback]);

  const selection = isUnstaged
    ? { isChecked, toggle: onToggleBlock, revert: onRevertBlock }
    : undefined;
  const editProps = isUnstaged && inlineEdit.ready ? { editLine: inlineEdit.editLine } : undefined;
  const editStatus = isUnstaged ? { saving: inlineEdit.saving, error: inlineEdit.error } : undefined;

  return (
    <div ref={rootRef} data-file-id={file.id} style={{ borderBottom: '1px solid var(--line-2)' }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          padding: '6px var(--s-4)',
          background: active ? 'var(--bg-2)' : 'var(--bg-1)',
          borderBottom: '1px solid var(--line-2)',
          borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={toggleCollapsed}
      >
        <ChevronRight
          size={14}
          strokeWidth={2}
          style={{
            transform: collapsed ? 'none' : 'rotate(90deg)',
            transition: 'transform 150ms var(--ease-std)',
            color: 'var(--fg-3)',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-xs)',
            color: active ? 'var(--accent)' : 'var(--fg-1)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {file.path}
        </span>
        {file.source === 'untracked' && <span className="eyebrow" style={{ color: 'var(--accent)' }}>UNTRACKED</span>}
        {file.source !== 'untracked' && file.isNew && <span className="eyebrow" style={{ color: 'var(--accent)' }}>NEW</span>}
        {file.isDeleted && <span className="eyebrow" style={{ color: 'var(--danger)' }}>DEL</span>}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--ok)' }}>+{file.add}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--danger)' }}>−{file.del}</span>
        {collapsed && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--fg-4)' }}>
            {file.parsed.chunks.length} {file.parsed.chunks.length === 1 ? 'hunk' : 'hunks'} · collapsed
          </span>
        )}
        <div
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)', flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          {isUnstaged && onAccept && (
            <HeaderChip
              label="ACCEPT"
              icon={Check}
              tone="accent"
              active={acceptState === 'all'}
              partial={acceptState === 'partial'}
              title={acceptState === 'all' ? 'Uncheck all blocks' : 'Check all blocks for the next commit'}
              onClick={() => { if (!acceptDisabled) onAccept(); }}
            />
          )}
          {isUnstaged && onRollback && (
            <HeaderChip
              label={rollbackBusy ? 'ROLLING BACK…' : 'ROLLBACK'}
              icon={RotateCcw}
              tone="danger"
              busy={rollbackBusy}
              title="Discard all changes in this file"
              onClick={requestRollback}
            />
          )}
          {file.source === 'staged' && onUnstage && (
            <HeaderChip
              label={unstageBusy ? 'UNSTAGING…' : 'UNSTAGE'}
              icon={Minus}
              busy={unstageBusy}
              title="Unstage this file"
              onClick={onUnstage}
            />
          )}
          {file.source === 'untracked' && onStage && (
            <HeaderChip
              label={stageBusy ? 'STAGING…' : 'STAGE'}
              icon={Plus}
              tone="accent"
              busy={stageBusy}
              title="Stage (track) this file"
              onClick={onStage}
            />
          )}
          {file.source === 'untracked' && onIgnore && (
            <HeaderChip
              label={ignoreBusy ? 'IGNORING…' : 'IGNORE'}
              icon={EyeOff}
              busy={ignoreBusy}
              title="Add to .gitignore"
              onClick={onIgnore}
            />
          )}
        </div>
      </div>

      {pendingRollback && (
        <div
          style={{
            padding: '10px var(--s-4)',
            background: 'color-mix(in srgb, var(--danger) 7%, transparent)',
            borderBottom: '1px solid color-mix(in srgb, var(--danger) 20%, transparent)',
          }}
        >
          <RevertConfirmCard
            title="Roll back all changes?"
            subtitle="Cannot be undone."
            confirmLabel={rollbackBusy ? 'Rolling back' : 'Roll back'}
            busy={rollbackBusy}
            skip={skipConfirm}
            onToggleSkip={toggleSkipConfirm}
            onCancel={() => setPendingRollback(false)}
            onConfirm={() => void confirmRollback()}
          />
        </div>
      )}

      {!collapsed && (
        bodyMounted ? (
          <div style={{ padding: 'var(--s-4)' }}>
            <DiffViewer
              target={file.parsed}
              path={file.path}
              navFilePath={navFilePath}
              onOpenInEditor={onOpenInEditor}
              mode={mode}
              selection={selection}
              editProps={editProps}
              editStatus={editStatus}
            />
          </div>
        ) : (
          <div style={{ height: estimatedBodyHeight ?? 200 }} aria-hidden />
        )
      )}
    </div>
  );
}
