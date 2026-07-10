import { useEffect, useRef, useState } from 'react';
import { useFileBuffer } from '../../hooks/useFileBuffer.js';
import { MonacoPane } from './MonacoPane.js';
import { MarkdownPreview } from './MarkdownPreview.js';
import { CsvPreview } from './CsvPreview.js';
import { ResizeDivider } from '../ResizeDivider.js';
import { LoadingState, ErrorState } from '../primitives/index.js';
import { previewKind, monacoLanguageFor, type PreviewKind } from '../../utils/langFromPath.js';

export type ViewMode = 'edit' | 'preview' | 'split';

const MD_SPLIT_RATIO_KEY = 'argus.explorer.splitRatio';

/** Buffer state surfaced upward so the workbench chrome (path/dirty/save/⌘S)
 *  can act on whichever tab is focused without owning the buffer itself. */
export interface TabBufferSnapshot {
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  error: string | null;
  conflict: boolean;
  save: () => Promise<void>;
  reload: () => Promise<void>;
}

interface EditorTabProps {
  sessionId: string;
  path: string;
  /** Session root folder — used to resolve leading-"/" links in markdown preview. */
  rootPath: string;
  /** When false the tab stays mounted but hidden, preserving its buffer + Monaco view state. */
  visible: boolean;
  theme: 'dark' | 'light';
  viewMode: ViewMode;
  revealLine?: number;
  revealNonce?: number;
  /** Called whenever this tab's buffer state changes, so chrome can reflect it. */
  onState?: (path: string, snap: TabBufferSnapshot) => void;
  /** Called on unmount so the workbench can drop this tab's state entry. */
  onUnmount?: (path: string) => void;
}

export function EditorTab({
  sessionId,
  path,
  rootPath,
  visible,
  theme,
  viewMode,
  revealLine,
  revealNonce,
  onState,
  onUnmount,
}: EditorTabProps) {
  const buffer = useFileBuffer({ sessionId, filePath: path });
  const kind = previewKind(path);

  // Surface buffer state upward. save/reload are stable callbacks from the hook,
  // so this only re-fires when the primitive status fields actually change.
  useEffect(() => {
    onState?.(path, {
      dirty: buffer.dirty,
      saving: buffer.saving,
      loading: buffer.loading,
      error: buffer.error,
      conflict: buffer.conflict,
      save: buffer.save,
      reload: buffer.reload,
    });
  }, [path, buffer.dirty, buffer.saving, buffer.loading, buffer.error, buffer.conflict, buffer.save, buffer.reload, onState]);

  useEffect(() => () => onUnmount?.(path), [path, onUnmount]);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: visible ? 'flex' : 'none',
        flexDirection: 'column',
      }}
    >
      {buffer.loading ? (
        <LoadingState label="Loading file" />
      ) : buffer.error ? (
        <ErrorState title="Failed to open file" detail={buffer.error} onRetry={() => void buffer.reload()} />
      ) : (
        <EditorArea
          path={path}
          rootPath={rootPath}
          value={buffer.content}
          onChange={buffer.setContent}
          onSave={() => void buffer.save()}
          theme={theme}
          kind={kind}
          viewMode={viewMode}
          revealLine={revealLine}
          revealNonce={revealNonce}
        />
      )}
    </div>
  );
}

interface EditorAreaProps {
  path: string;
  rootPath: string;
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  theme: 'dark' | 'light';
  kind: PreviewKind | null;
  viewMode: ViewMode;
  revealLine?: number;
  revealNonce?: number;
}

function PreviewPane({ kind, source, filePath, rootPath }: { kind: PreviewKind; source: string; filePath: string; rootPath: string }) {
  return kind === 'csv' ? (
    <CsvPreview source={source} />
  ) : (
    <MarkdownPreview source={source} filePath={filePath} rootPath={rootPath} />
  );
}

function EditorArea({ path, rootPath, value, onChange, onSave, theme, kind, viewMode, revealLine, revealNonce }: EditorAreaProps) {
  const language = monacoLanguageFor(path);
  const [splitRatio, setSplitRatio] = useState<number>(() => readStoredRatio());
  const [isDragging, setIsDragging] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MD_SPLIT_RATIO_KEY, String(splitRatio));
  }, [splitRatio]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const host = hostRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      setSplitRatio(Math.min(0.85, Math.max(0.15, ratio)));
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = prevCursor;
    };
  }, [isDragging]);

  if (!kind || viewMode === 'edit') {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <MonacoPane
          value={value}
          onChange={onChange}
          language={language}
          theme={theme}
          onSaveShortcut={onSave}
          path={path}
          revealLine={revealLine}
          revealNonce={revealNonce}
        />
      </div>
    );
  }

  if (viewMode === 'preview') {
    return <PreviewPane kind={kind} source={value} filePath={path} rootPath={rootPath} />;
  }

  return (
    <div ref={hostRef} style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div style={{ flexBasis: `${splitRatio * 100}%`, minWidth: 0, display: 'flex' }}>
        <MonacoPane
          value={value}
          onChange={onChange}
          language={language}
          theme={theme}
          onSaveShortcut={onSave}
          path={path}
          revealLine={revealLine}
          revealNonce={revealNonce}
        />
      </div>
      <ResizeDivider
        isDragging={isDragging}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
      />
      <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
        <PreviewPane kind={kind} source={value} filePath={path} rootPath={rootPath} />
      </div>
    </div>
  );
}

function readStoredRatio(): number {
  if (typeof window === 'undefined') return 0.5;
  const raw = window.localStorage.getItem(MD_SPLIT_RATIO_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(0.85, Math.max(0.15, n));
}
