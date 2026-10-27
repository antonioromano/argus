import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { modelsFromRaw, shouldAutoCollapse, estimateBodyHeight } from '../overlays/diff/diffModel.js';
import { FileSection } from './FileSection.js';
import { useFileScrollSpy } from './useFileScrollSpy.js';

const noop = () => {};
const never = () => false;

export interface ReadOnlyDiffProps {
  /** Raw unified diff of any number of files (`git show`, `git diff`, `gh pr diff`). */
  diff: string;
  /** Session the diff belongs to (FileSection keys its inline-edit hook on it; never enabled here). */
  sessionId: string;
  /** Work root the diff's paths are relative to. */
  folderPath: string;
  mode: 'split' | 'unified';
  /** Scroll to this repo-relative path once mounted. */
  initialFile?: string;
  /** Shown above the file list (e.g. which files were too large to include). */
  notice?: ReactNode;
  /** Shown instead of the sections when the diff has no files. */
  empty?: ReactNode;
}

/**
 * A diff that isn't the working tree's — a commit, a pull request — shown the
 * way the Diff workbench shows changes (file list on the left, every file's
 * diff in one scroll on the right, split or unified) but read-only: no
 * staging, reverting, inline editing or symbol navigation, since the files on
 * disk aren't the ones being shown.
 *
 * Reuse: hand it the raw diff text; parsing, the file list, scroll-spy and
 * lazy mounting of large diffs are handled here.
 */
export function ReadOnlyDiff({ diff, sessionId, folderPath, mode, initialFile, notice, empty }: ReadOnlyDiffProps) {
  const files = useMemo(() => modelsFromRaw(diff, 'readonly'), [diff]);
  const { mainRef, registerRef, resolvedActiveId, nearIds, scrollToFile } = useFileScrollSpy(files);
  const selectedRowRef = useRef<HTMLButtonElement>(null);
  const appliedInitialRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialFile || appliedInitialRef.current === initialFile) return;
    const match = files.find((f) => f.path === initialFile);
    if (!match) return;
    appliedInitialRef.current = initialFile;
    requestAnimationFrame(() => scrollToFile(match.id));
  }, [files, initialFile, scrollToFile]);

  // Keep the active file's row visible as the scroll-spy moves it.
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [resolvedActiveId]);

  return (
    <div className="argus-rodiff">
      <aside className="argus-rodiff-files argus-scroll" aria-label="Changed files">
        {notice}
        {files.map((f) => {
          const sel = resolvedActiveId === f.id;
          return (
            <button
              key={f.id}
              ref={sel ? selectedRowRef : undefined}
              type="button"
              className="argus-rodiff-file"
              data-selected={sel || undefined}
              title={f.fromPath ? `${f.fromPath} → ${f.path}` : f.path}
              onClick={() => scrollToFile(f.id)}
            >
              <span className="argus-rodiff-file-path">{f.path}</span>
              {f.isNew && <span className="eyebrow argus-rodiff-new">NEW</span>}
              {f.isDeleted && <span className="eyebrow argus-rodiff-del">DEL</span>}
              {f.fromPath && <span className="eyebrow argus-rodiff-ren">REN</span>}
              <span className="argus-rodiff-add">+{f.add}</span>
              <span className="argus-rodiff-delnum">−{f.del}</span>
            </button>
          );
        })}
      </aside>
      <main ref={mainRef} className="argus-rodiff-main argus-scroll">
        {files.length === 0
          ? empty ?? <div className="argus-rodiff-empty">No textual changes.</div>
          : files.map((f) => (
            <FileSection
              key={f.id}
              file={f}
              sessionId={sessionId}
              folderPath={folderPath}
              mode={mode}
              active={resolvedActiveId === f.id}
              registerRef={registerRef}
              defaultCollapsed={shouldAutoCollapse(f.parsed)}
              renderBody={nearIds.has(f.id)}
              estimatedBodyHeight={estimateBodyHeight(f.parsed)}
              isChecked={never}
              onToggleBlock={noop}
              onRevertBlock={noop}
            />
          ))}
      </main>
    </div>
  );
}
