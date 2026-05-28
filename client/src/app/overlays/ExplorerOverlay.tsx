import { useCallback, useEffect, useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import {
  X,
  FolderOpen,
  RefreshCw,
  Save,
  Edit3,
  Eye,
  SplitSquareHorizontal,
  AlertTriangle,
} from 'lucide-react';
import { Button, IconButton, Chip, LoadingState, ErrorState } from '../../components/primitives/index.js';
import { useFileTree } from '../../hooks/useFileTree.js';
import { useFileBuffer } from '../../hooks/useFileBuffer.js';
import { useGitFileStatuses } from '../../hooks/useGitFileStatuses.js';
import { FileTreeView } from '../../components/explorer/FileTreeView.js';
import { MonacoPane } from '../../components/explorer/MonacoPane.js';
import { MarkdownPreview } from '../../components/explorer/MarkdownPreview.js';
import { useTheme } from '../../context/ThemeContext.js';
import { isMarkdownPath, monacoLanguageFor } from '../../utils/langFromPath.js';
import { ResizeDivider } from '../../components/ResizeDivider.js';

const SPLIT_RATIO_KEY = 'argus.explorer.splitRatio';

interface ExplorerOverlayProps {
  session: SessionInfo;
  onClose: () => void;
  initialFilePath?: string;
}

type ViewMode = 'edit' | 'preview' | 'split';

export function ExplorerOverlay({ session, onClose, initialFilePath }: ExplorerOverlayProps) {
  const { theme } = useTheme();
  const [selectedPath, setSelectedPath] = useState<string | null>(initialFilePath ?? null);
  const [viewMode, setViewMode] = useState<ViewMode>(
    initialFilePath && isMarkdownPath(initialFilePath) ? 'split' : 'edit',
  );

  const tree = useFileTree(session.folderPath);
  const gitStatuses = useGitFileStatuses({ sessionId: session.id, enabled: true });
  const buffer = useFileBuffer({ sessionId: session.id, filePath: selectedPath });

  const onPickFile = useCallback((path: string) => {
    setSelectedPath(path);
    setViewMode(isMarkdownPath(path) ? 'split' : 'edit');
  }, []);

  // ⌘S / Ctrl+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      void buffer.save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [buffer]);

  const isMd = !!selectedPath && isMarkdownPath(selectedPath);

  return (
    <div
      style={{
        width: '92vw',
        height: '88vh',
        maxWidth: 1400,
        background: 'var(--bg-0)',
        border: '1px solid var(--line-3)',
        borderRadius: 'var(--r-4)',
        boxShadow: 'var(--shadow-sheet)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          padding: 'var(--s-3) var(--s-4)',
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        <FolderOpen size={14} strokeWidth={1.6} color="var(--accent)" />
        <div className="eyebrow" style={{ color: 'var(--accent)' }}>ARGUS · EXPLORER</div>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-sm)',
            color: 'var(--fg-1)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '40%',
          }}
        >
          {selectedPath ?? session.folderPath}
        </span>
        {buffer.dirty && <Chip dot="var(--dirty)">UNSAVED</Chip>}
        {buffer.saving && <Chip dot="var(--accent)">SAVING…</Chip>}
        <div style={{ flex: 1 }} />
        {isMd && (
          <SegmentedControl
            value={viewMode}
            onChange={setViewMode}
          />
        )}
        <IconButton icon={RefreshCw} label="Refresh tree" size="sm" onClick={tree.refresh} />
        <Button
          variant={buffer.dirty ? 'primary' : 'ghost'}
          size="sm"
          icon={Save}
          onClick={() => void buffer.save()}
          disabled={!buffer.dirty || buffer.saving}
        >
          Save
        </Button>
        <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <aside
          style={{
            width: 280,
            flexShrink: 0,
            background: 'var(--bg-1)',
            borderRight: '1px solid var(--line-2)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          {tree.isLoading && tree.visibleNodes.length === 0 ? (
            <LoadingState label="Loading tree" />
          ) : (
            <FileTreeView
              nodes={tree.visibleNodes}
              selectedPath={selectedPath}
              gitStatuses={gitStatuses}
              onSelect={(node) => {
                if (node.entry.isFile) {
                  onPickFile(node.path);
                } else {
                  tree.toggle(node.path);
                }
              }}
            />
          )}
        </aside>

        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {buffer.conflict && (
            <ConflictBanner onReload={() => void buffer.reload()} />
          )}
          {!selectedPath && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}>
              Pick a file from the tree.
            </div>
          )}
          {selectedPath && buffer.loading && <LoadingState label="Loading file" />}
          {selectedPath && buffer.error && !buffer.loading && (
            <ErrorState title="Failed to open file" detail={buffer.error} onRetry={() => void buffer.reload()} />
          )}
          {selectedPath && !buffer.loading && !buffer.error && (
            <EditorArea
              path={selectedPath}
              value={buffer.content}
              onChange={buffer.setContent}
              onSave={() => void buffer.save()}
              theme={theme}
              isMd={isMd}
              viewMode={viewMode}
            />
          )}
        </main>
      </div>
    </div>
  );
}

interface EditorAreaProps {
  path: string;
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  theme: 'dark' | 'light';
  isMd: boolean;
  viewMode: ViewMode;
}

function EditorArea({ path, value, onChange, onSave, theme, isMd, viewMode }: EditorAreaProps) {
  const language = monacoLanguageFor(path);
  const [splitRatio, setSplitRatio] = useState<number>(() => readStoredRatio());
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SPLIT_RATIO_KEY, String(splitRatio));
  }, [splitRatio]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const host = document.querySelector<HTMLElement>('[data-explorer-split]');
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const clamped = Math.min(0.85, Math.max(0.15, ratio));
      setSplitRatio(clamped);
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

  if (!isMd || viewMode === 'edit') {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <MonacoPane
          value={value}
          onChange={onChange}
          language={language}
          theme={theme}
          onSaveShortcut={onSave}
        />
      </div>
    );
  }

  if (viewMode === 'preview') {
    return <MarkdownPreview source={value} />;
  }

  // Split
  return (
    <div data-explorer-split style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div style={{ flexBasis: `${splitRatio * 100}%`, minWidth: 0, display: 'flex' }}>
        <MonacoPane
          value={value}
          onChange={onChange}
          language={language}
          theme={theme}
          onSaveShortcut={onSave}
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
        <MarkdownPreview source={value} />
      </div>
    </div>
  );
}

function readStoredRatio(): number {
  if (typeof window === 'undefined') return 0.5;
  const raw = window.localStorage.getItem(SPLIT_RATIO_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(0.85, Math.max(0.15, n));
}

function SegmentedControl({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const items: { id: ViewMode; label: string; icon: typeof Edit3 }[] = [
    { id: 'edit', label: 'EDITOR', icon: Edit3 },
    { id: 'preview', label: 'PREVIEW', icon: Eye },
    { id: 'split', label: 'SPLIT', icon: SplitSquareHorizontal },
  ];
  return (
    <div style={{ display: 'inline-flex', borderRadius: 'var(--r-2)', overflow: 'hidden', border: '1px solid var(--line-2)' }}>
      {items.map((it) => {
        const active = value === it.id;
        const Icon = it.icon;
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px var(--s-2)',
              background: active ? 'var(--bg-3)' : 'var(--bg-2)',
              color: active ? 'var(--accent)' : 'var(--fg-2)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-tiny)',
              letterSpacing: 'var(--tracking-eye)',
            }}
          >
            <Icon size={11} strokeWidth={1.6} /> {it.label}
          </button>
        );
      })}
    </div>
  );
}

function ConflictBanner({ onReload }: { onReload: () => void }) {
  return (
    <div
      role="alert"
      className="eyebrow"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 16px',
        background: 'var(--warn-bg)',
        borderBottom: '1px solid color-mix(in srgb, var(--warn) 33%, transparent)',
        color: 'var(--warn)',
        fontSize: 'var(--t-tiny)',
        flexShrink: 0,
      }}
    >
      <AlertTriangle size={13} strokeWidth={1.6} />
      File changed on disk
      <div style={{ flex: 1 }} />
      <Button variant="ghost" size="sm" onClick={onReload}>Reload from disk</Button>
    </div>
  );
}
