import { useMemo, useState } from 'react';
import parseDiff from 'parse-diff';
import type { File as DiffFile } from 'parse-diff';
import { X, GitMerge, CheckCircle, AlertCircle, ChevronDown } from 'lucide-react';
import type { WorktreeMergePreviewResponse, MergePreviewFile, SessionInfo } from '@argus/shared';
import { LoadingState, EmptyState, Button, IconButton } from '../../components/primitives/index.js';
import { SplitDiff } from './SplitDiff.js';
import { useFocusTrap } from '../../hooks/useFocusTrap.js';
import { useRef } from 'react';

type MergeFlowPhase =
  | { phase: 'preview'; session: SessionInfo; targetBranch: string; parentRepoPath: string; preview: WorktreeMergePreviewResponse | null; availableBranches: string[] }
  | { phase: 'merging'; session: SessionInfo; targetBranch: string; parentRepoPath: string }
  | { phase: 'success'; session: SessionInfo; targetBranch: string; mergedBranch: string; parentRepoPath: string }
  | { phase: 'error'; session: SessionInfo; error: string; targetBranch?: string; parentRepoPath?: string };

interface MergePreviewSheetProps {
  mergeFlow: MergeFlowPhase;
  onClose: () => void;
  onMerge: (targetBranch: string) => void;
  onCleanUp: () => void;
}

function fileDot(f: MergePreviewFile): string {
  if (f.isNew) return 'var(--ok)';
  if (f.isDeleted) return 'var(--danger)';
  return 'var(--dirty)';
}

function MergeDiffViewer({ file }: { file: MergePreviewFile }) {
  const parsed: DiffFile | undefined = useMemo(() => {
    if (!file.diff) return undefined;
    return parseDiff(file.diff)[0];
  }, [file.diff]);

  if (!parsed || parsed.chunks.length === 0) {
    return (
      <div style={{ padding: 'var(--s-6)', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>
        No diff available.
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--s-4)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>
      <SplitDiff target={parsed} />
    </div>
  );
}

export function MergePreviewSheet({ mergeFlow, onClose, onMerge, onCleanUp }: MergePreviewSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const isLocked = mergeFlow.phase === 'merging';
  useFocusTrap({ isOpen: true, panelRef, onEscape: isLocked ? undefined : onClose });

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [localTarget, setLocalTarget] = useState<string | null>(null);

  const targetBranch = localTarget ?? ('targetBranch' in mergeFlow ? mergeFlow.targetBranch : undefined) ?? '';
  const sourceBranch = mergeFlow.phase === 'success' ? mergeFlow.mergedBranch : mergeFlow.session.worktreeBranch ?? '';

  const preview = mergeFlow.phase === 'preview' ? mergeFlow.preview : null;
  const availableBranches = mergeFlow.phase === 'preview' ? mergeFlow.availableBranches : [];
  const files = preview?.files ?? [];

  const effectiveFile: MergePreviewFile | undefined = useMemo(() => {
    if (files.length === 0) return undefined;
    const found = selectedFile ? files.find((f) => f.path === selectedFile) : undefined;
    return found ?? files[0];
  }, [files, selectedFile]);

  const handleTargetChange = (branch: string) => {
    setLocalTarget(branch);
  };

  const handleMerge = () => {
    onMerge(targetBranch);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={isLocked ? undefined : onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 'var(--z-sheet)',
          background: 'var(--bg-overlay)',
          animation: 'argus-fade-in var(--dur-base) var(--ease-out)',
        }}
      />

      {/* Sheet */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal
        aria-label="Merge preview"
        tabIndex={-1}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(780px, 82vw)',
          zIndex: 'calc(var(--z-sheet) + 1)',
          background: 'var(--bg-2)',
          borderLeft: '1px solid var(--line-3)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-sheet)',
          animation: 'merge-sheet-in var(--dur-base) var(--ease-out) both',
          outline: 'none',
        }}
      >
        <style>{`
          @keyframes merge-sheet-in {
            from { transform: translateX(40px); opacity: 0; }
            to   { transform: translateX(0);   opacity: 1; }
          }
        `}</style>

        {/* Header */}
        <div style={{
          height: 48,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-3)',
          padding: '0 var(--s-4)',
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line-2)',
        }}>
          <IconButton
            icon={X}
            label="Close"
            size="sm"
            onClick={isLocked ? undefined : onClose}
            disabled={isLocked}
          />

          <div className="eyebrow" style={{ color: 'var(--accent)', flexShrink: 0 }}>MERGE</div>

          {/* Branch flow */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-xs)',
              color: 'var(--fg-1)',
              background: 'var(--bg-3)',
              border: '1px solid var(--line-2)',
              borderRadius: 'var(--r-2)',
              padding: '2px 7px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 220,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-waiting)', flexShrink: 0, display: 'inline-block' }} />
              {sourceBranch || mergeFlow.session.name}
            </span>

            <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>→</span>

            {/* Target branch selector */}
            {availableBranches.length > 1 ? (
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <select
                  value={targetBranch}
                  onChange={(e) => handleTargetChange(e.target.value)}
                  disabled={isLocked}
                  style={{
                    appearance: 'none',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--t-xs)',
                    color: 'var(--accent)',
                    background: 'var(--accent-bg)',
                    border: '1px solid var(--accent-edge)',
                    borderRadius: 'var(--r-2)',
                    padding: '2px 22px 2px 7px',
                    cursor: isLocked ? 'not-allowed' : 'pointer',
                    outline: 'none',
                  }}
                >
                  {availableBranches.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <ChevronDown size={10} style={{ position: 'absolute', right: 6, pointerEvents: 'none', color: 'var(--accent)' }} />
              </div>
            ) : (
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-xs)',
                color: 'var(--accent)',
                background: 'var(--accent-bg)',
                border: '1px solid var(--accent-edge)',
                borderRadius: 'var(--r-2)',
                padding: '2px 7px',
                whiteSpace: 'nowrap',
              }}>
                {targetBranch}
              </span>
            )}
          </div>

          {/* Stats */}
          {preview && (
            <div style={{ display: 'flex', gap: 'var(--s-2)', flexShrink: 0 }}>
              {preview.totalAdditions > 0 && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', color: 'var(--diff-add-fg)', background: 'var(--diff-add)', borderRadius: 'var(--r-1)', padding: '2px 6px', fontWeight: 600 }}>
                  +{preview.totalAdditions}
                </span>
              )}
              {preview.totalDeletions > 0 && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', color: 'var(--diff-del-fg)', background: 'var(--diff-del)', borderRadius: 'var(--r-1)', padding: '2px 6px', fontWeight: 600 }}>
                  −{preview.totalDeletions}
                </span>
              )}
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', color: 'var(--fg-3)', background: 'var(--bg-3)', borderRadius: 'var(--r-1)', padding: '2px 6px' }}>
                {preview.files.length} {preview.files.length === 1 ? 'file' : 'files'}
              </span>
            </div>
          )}
        </div>

        {/* Success banner */}
        {mergeFlow.phase === 'success' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s-3)',
            padding: 'var(--s-3) var(--s-4)',
            background: 'color-mix(in srgb, var(--ok) 10%, transparent)',
            borderBottom: '1px solid color-mix(in srgb, var(--ok) 30%, transparent)',
            flexShrink: 0,
          }}>
            <CheckCircle size={16} color="var(--ok)" strokeWidth={1.6} />
            <span style={{ fontSize: 'var(--t-sm)', color: 'var(--ok)', fontWeight: 500 }}>
              {mergeFlow.mergedBranch} merged into <strong>{mergeFlow.targetBranch}</strong>
            </span>
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', opacity: isLocked ? 0.5 : 1, transition: 'opacity 0.15s' }}>

          {/* Loading state */}
          {mergeFlow.phase === 'preview' && preview === null && (
            <LoadingState label="Loading diff…" />
          )}

          {/* No changes */}
          {preview && files.length === 0 && (
            <EmptyState icon={GitMerge} title="No changes" hint="Nothing to merge." />
          )}

          {/* File sidebar */}
          {files.length > 0 && (
            <aside
              className="argus-scroll"
              style={{
                width: 240,
                flexShrink: 0,
                background: 'var(--bg-1)',
                borderRight: '1px solid var(--line-2)',
                overflowY: 'auto',
              }}
            >
              <div className="eyebrow" style={{ padding: 'var(--s-3) var(--s-4) var(--s-1)', color: 'var(--fg-3)' }}>
                CHANGED · {files.length}
              </div>
              {files.map((f) => {
                const isActive = effectiveFile?.path === f.path;
                return (
                  <button
                    key={f.path}
                    onClick={() => setSelectedFile(f.path)}
                    style={{
                      all: 'unset',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--s-2)',
                      padding: 'var(--s-2) var(--s-4)',
                      width: '100%',
                      background: isActive ? 'var(--bg-3)' : 'transparent',
                      borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-3)'; }}
                    onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: fileDot(f), flexShrink: 0 }} />
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--t-xs)',
                      color: isActive ? 'var(--fg-0)' : 'var(--fg-1)',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}>
                      {f.path.includes('/') ? (
                        <>
                          <span style={{ color: 'var(--fg-3)' }}>{f.path.slice(0, f.path.lastIndexOf('/') + 1)}</span>
                          {f.path.slice(f.path.lastIndexOf('/') + 1)}
                        </>
                      ) : f.path}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--diff-add-fg)', fontWeight: 600, flexShrink: 0 }}>
                      {f.additions > 0 ? `+${f.additions}` : ''}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--diff-del-fg)', fontWeight: 600, flexShrink: 0 }}>
                      {f.deletions > 0 ? `−${f.deletions}` : ''}
                    </span>
                  </button>
                );
              })}
            </aside>
          )}

          {/* Diff content */}
          {files.length > 0 && (
            <main className="argus-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', background: 'var(--bg-0)' }}>
              {effectiveFile && <MergeDiffViewer file={effectiveFile} />}
            </main>
          )}
        </div>

        {/* Error banner (above footer) */}
        {mergeFlow.phase === 'error' && (
          <div style={{
            margin: 'var(--s-3)',
            padding: 'var(--s-3)',
            background: 'var(--danger-bg)',
            border: '1px solid color-mix(in srgb, var(--danger) 33%, transparent)',
            borderRadius: 'var(--r-3)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', marginBottom: 'var(--s-2)' }}>
              <AlertCircle size={13} color="var(--danger)" strokeWidth={1.6} />
              <span style={{ fontSize: 'var(--t-xs)', fontWeight: 600, color: 'var(--danger)' }}>Merge failed</span>
            </div>
            <pre style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-xs)',
              color: 'var(--fg-1)',
              background: 'var(--bg-inset)',
              padding: 'var(--s-3)',
              borderRadius: 'var(--r-2)',
              overflow: 'auto',
              maxHeight: 120,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {mergeFlow.error}
            </pre>
          </div>
        )}

        {/* Footer */}
        <div style={{
          height: 52,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 var(--s-4)',
          background: 'var(--bg-1)',
          borderTop: '1px solid var(--line-2)',
        }}>
          <Button variant="ghost" size="md" onClick={isLocked ? undefined : onClose} disabled={isLocked}>
            {mergeFlow.phase === 'success' ? 'Done' : 'Cancel'}
          </Button>

          <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center' }}>
            {mergeFlow.phase === 'success' && (
              <Button variant="danger" size="md" onClick={onCleanUp}>
                Clean up session
              </Button>
            )}

            {mergeFlow.phase === 'merging' && (
              <Button variant="primary" size="md" disabled loading>
                Merging…
              </Button>
            )}

            {mergeFlow.phase === 'error' && (
              <Button variant="primary" size="md" icon={GitMerge} onClick={handleMerge}>
                Try again
              </Button>
            )}

            {mergeFlow.phase === 'preview' && (
              <Button
                variant="primary"
                size="md"
                icon={GitMerge}
                disabled={preview === null || files.length === 0}
                onClick={handleMerge}
              >
                Merge into {targetBranch}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
