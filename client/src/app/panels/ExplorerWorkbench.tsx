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
  Search,
  Shrink,
} from 'lucide-react';
import { Button, IconButton, Chip, LoadingState, ErrorState } from '../../components/primitives/index.js';
import { useFileTree } from '../../hooks/useFileTree.js';
import { useFileBuffer } from '../../hooks/useFileBuffer.js';
import { useGitFileStatuses } from '../../hooks/useGitFileStatuses.js';
import { ExplorerFileTree } from '../../components/explorer/ExplorerFileTree.js';
import { FileSearchPanel } from '../../components/explorer/FileSearchPanel.js';
import { MonacoPane } from '../../components/explorer/MonacoPane.js';
import { MarkdownPreview } from '../../components/explorer/MarkdownPreview.js';
import { useTheme } from '../../context/theme-context.js';
import { isMarkdownPath, monacoLanguageFor } from '../../utils/langFromPath.js';
import { ResizeDivider } from '../../components/ResizeDivider.js';

const SPLIT_RATIO_KEY = 'argus.explorer.splitRatio';

interface ExplorerWorkbenchProps {
  session: SessionInfo;
  /** Close the tool window entirely (return to plain terminal focus). */
  onClose: () => void;
  /** Collapse the maximized tool window back to the docked right rail (⤡). */
  onRestore?: () => void;
  initialFilePath?: string;
  initialLine?: number;
  initialQuery?: string;
}

type ViewMode = 'edit' | 'preview' | 'split';

export function ExplorerWorkbench({ session, onClose, onRestore, initialFilePath, initialLine, initialQuery }: ExplorerWorkbenchProps) {
  const { theme } = useTheme();
  const [selectedPath, setSelectedPath] = useState<string | null>(initialFilePath ?? null);
  const [viewMode, setViewMode] = useState<ViewMode>(
    initialFilePath && isMarkdownPath(initialFilePath) ? 'split' : 'edit',
  );
  // Opened from a palette search → carry the query in so the same result list shows.
  const [searchOpen, setSearchOpen] = useState(!!initialQuery);
  const [revealLine, setRevealLine] = useState<number | undefined>(initialLine);

  const tree = useFileTree(session.folderPath, session.id);
  const gitStatuses = useGitFileStatuses({ sessionId: session.id, enabled: true });
  const buffer = useFileBuffer({ sessionId: session.id, filePath: selectedPath });

  const onPickFile = useCallback((path: string, line?: number) => {
    setSelectedPath(path);
    setRevealLine(line);
    setViewMode(isMarkdownPath(path) ? 'split' : 'edit');
  }, []);

  // ⌘S / ⌘K — capture phase so ⌘K beats the global CommandPalette handler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); void buffer.save(); }
      if (k === 'k') { e.preventDefault(); e.stopPropagation(); setSearchOpen((o) => !o); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [buffer]);

  const isMd = !!selectedPath && isMarkdownPath(selectedPath);

  return (
    <div
      style={{
        flex: 1,
        width: '100%',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-0)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
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
        <IconButton icon={Search} label="Search files (⌘K)" size="sm" onClick={() => setSearchOpen((o) => !o)} />
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
        {onRestore && <IconButton icon={Shrink} label="Restore to side panel" size="sm" onClick={onRestore} />}
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
            position: 'relative',
          }}
        >
          {tree.isLoading && tree.visibleNodes.length === 0 ? (
            <LoadingState label="Loading tree" />
          ) : (
            <ExplorerFileTree
              tree={tree}
              sessionId={session.id}
              gitStatuses={gitStatuses}
              selectedPath={selectedPath}
              onOpenFile={(path) => onPickFile(path)}
            />
          )}
          {searchOpen && (
            <FileSearchPanel
              folderPath={session.folderPath}
              initialQuery={initialQuery}
              onSelectFile={(path, line) => onPickFile(path, line)}
              onClose={() => setSearchOpen(false)}
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
              revealLine={revealLine}
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
  revealLine?: number;
}

function EditorArea({ path, value, onChange, onSave, theme, isMd, viewMode, revealLine }: EditorAreaProps) {
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
          revealLine={revealLine}
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
          revealLine={revealLine}
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
