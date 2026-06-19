import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import { Button, IconButton, Chip, LoadingState } from '../../components/primitives/index.js';
import { useFileTree } from '../../hooks/useFileTree.js';
import { useGitFileStatuses } from '../../hooks/useGitFileStatuses.js';
import { useEditorGroups } from '../../hooks/useEditorGroups.js';
import { ExplorerFileTree } from '../../components/explorer/ExplorerFileTree.js';
import { FileSearchPanel } from '../../components/explorer/FileSearchPanel.js';
import { EditorTab, type ViewMode, type TabBufferSnapshot } from '../../components/explorer/EditorTab.js';
import { EditorTabStrip } from '../../components/explorer/EditorTabStrip.js';
import { useTheme } from '../../context/theme-context.js';
import { isMarkdownPath } from '../../utils/langFromPath.js';
import { ResizeDivider } from '../../components/ResizeDivider.js';
import { symbolNavContext } from '../../components/explorer/registerSymbolProviders.js';

const COLUMN_RATIO_KEY = 'argus.explorer.columnRatio';

interface ExplorerWorkbenchProps {
  session: SessionInfo;
  /** Close the tool window entirely (return to plain terminal focus). */
  onClose: () => void;
  initialFilePath?: string;
  initialLine?: number;
  initialQuery?: string;
}

interface RevealTarget {
  path: string;
  line?: number;
  nonce: number;
}

interface DragState {
  path: string;
  gi: number;
  sx: number;
  sy: number;
  started: boolean;
  drop: { mode: 'split' | 'move'; target?: number } | null;
}

interface ZoneRect {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
}

export function ExplorerWorkbench({ session, onClose, initialFilePath, initialLine, initialQuery }: ExplorerWorkbenchProps) {
  const { theme } = useTheme();
  const groups = useEditorGroups(initialFilePath ?? null);

  const [tabStates, setTabStates] = useState<Record<string, TabBufferSnapshot>>({});
  const [viewModes, setViewModes] = useState<Record<string, ViewMode>>({});
  const [searchOpen, setSearchOpen] = useState(!!initialQuery);
  const [searchQuery, setSearchQuery] = useState<string | undefined>(initialQuery);
  const [reveal, setReveal] = useState<RevealTarget | null>(
    initialFilePath ? { path: initialFilePath, line: initialLine, nonce: 1 } : null,
  );

  const [columnRatio, setColumnRatio] = useState<number>(() => readColumnRatio());
  const [divDragging, setDivDragging] = useState(false);

  const editorRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const stateRef = useRef(groups.state);
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const [zone, setZone] = useState<ZoneRect | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);

  useEffect(() => {
    stateRef.current = groups.state;
  }, [groups.state]);

  const gstate = groups.state;
  const isSplit = gstate.groups.length === 2;
  const focusedGroup = gstate.groups[gstate.focused];
  const focusedPath = focusedGroup?.active ?? null;
  const focusedSnap = focusedPath ? tabStates[focusedPath] : undefined;
  const isMd = !!focusedPath && isMarkdownPath(focusedPath);

  const viewModeFor = (path: string): ViewMode =>
    viewModes[path] ?? (isMarkdownPath(path) ? 'split' : 'edit');

  // Pinned open — deliberate jumps (double-click, search, symbol-nav, initial).
  const onPickFile = useCallback(
    (path: string, line?: number) => {
      groups.open(path);
      setReveal({ path, line, nonce: Date.now() });
    },
    [groups],
  );

  // Preview open — single-click in the tree (reuses the italic preview slot).
  const onPreviewFile = useCallback(
    (path: string) => {
      groups.preview(path);
      setReveal({ path, line: undefined, nonce: Date.now() });
    },
    [groups],
  );

  const onTabState = useCallback(
    (path: string, snap: TabBufferSnapshot) => {
      setTabStates((s) => ({ ...s, [path]: snap }));
      // Editing a preview file promotes it to a permanent tab.
      if (snap.dirty) {
        const st = stateRef.current;
        const gi = st.groups.findIndex((g) => g.preview === path);
        if (gi >= 0) groups.pin(gi, path);
      }
    },
    [groups],
  );

  const onTabUnmount = useCallback((path: string) => {
    setTabStates((s) => {
      const next = { ...s };
      delete next[path];
      return next;
    });
  }, []);

  // Keep ⌘S pointed at the focused tab without re-binding the listener each render.
  const saveRef = useRef<(() => Promise<void>) | undefined>(undefined);
  useEffect(() => {
    saveRef.current = focusedSnap?.save;
  }, [focusedSnap]);

  // ⌘W closes the focused group's active tab (no-op when nothing is open).
  const closeFocused = useCallback(() => {
    const st = stateRef.current;
    const active = st.groups[st.focused]?.active;
    if (active) groups.close(st.focused, active);
  }, [groups]);
  const closeFocusedRef = useRef(closeFocused);
  useEffect(() => {
    closeFocusedRef.current = closeFocused;
  }, [closeFocused]);

  // Wire the symbol-nav context so cross-file go-to-definition and "Search
  // Workspace" route through this workbench's focused group.
  useEffect(() => {
    symbolNavContext.onOpen = (path, line) => onPickFile(path, line);
    symbolNavContext.searchFor = (q) => {
      setSearchQuery(q);
      setSearchOpen(true);
    };
  }, [onPickFile]);

  // ⌘S / ⌘K — capture phase so ⌘K beats the global CommandPalette handler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        void saveRef.current?.();
      }
      if (k === 'k') {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen((o) => !o);
      }
      if (k === 'w') {
        e.preventDefault();
        e.stopPropagation();
        closeFocusedRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  // Persist the two-column divider ratio.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COLUMN_RATIO_KEY, String(columnRatio));
  }, [columnRatio]);

  // Column divider drag.
  useEffect(() => {
    if (!divDragging) return;
    const onMove = (e: MouseEvent) => {
      const host = editorRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      setColumnRatio(Math.min(0.8, Math.max(0.2, ratio)));
    };
    const onUp = () => setDivDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    const prev = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = prev;
    };
  }, [divDragging]);

  // ---- tab drag (split / merge) ----
  const onDragMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
      d.started = true;
      setDraggingPath(d.path);
    }
    setGhost({ x: e.clientX, y: e.clientY, label: baseName(d.path) });

    const host = editorRef.current;
    if (!host) return;
    const er = host.getBoundingClientRect();
    const inside = e.clientX >= er.left && e.clientX <= er.right && e.clientY >= er.top && e.clientY <= er.bottom;
    if (!inside) {
      d.drop = null;
      setZone(null);
      return;
    }
    const st = stateRef.current;
    if (st.groups.length === 1) {
      const g = st.groups[0];
      if (g.tabs.length > 1 && e.clientX > er.left + er.width / 2) {
        d.drop = { mode: 'split' };
        setZone({ left: er.width / 2, top: 0, width: er.width / 2, height: er.height, label: 'Open on the right' });
      } else {
        d.drop = null;
        setZone(null);
      }
    } else {
      let target = -1;
      host.querySelectorAll<HTMLElement>('[data-group]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right) target = Number(el.dataset.group);
      });
      if (target >= 0 && target !== d.gi) {
        const el = host.querySelector<HTMLElement>(`[data-group="${target}"]`);
        if (el) {
          const r = el.getBoundingClientRect();
          d.drop = { mode: 'move', target };
          setZone({ left: r.left - er.left, top: r.top - er.top, width: r.width, height: r.height, label: 'Move into this group' });
        }
      } else {
        d.drop = null;
        setZone(null);
      }
    }
  }, []);

  const onDragUp = useCallback(() => {
    window.removeEventListener('pointermove', onDragMove);
    const d = dragRef.current;
    if (d) {
      if (d.started && d.drop) {
        if (d.drop.mode === 'split') groups.splitRight(d.gi, d.path);
        else if (d.drop.mode === 'move' && d.drop.target != null) groups.moveTo(d.gi, d.drop.target, d.path);
      }
      // A plain click (no drag) activates via the tab's onClick handler.
    }
    dragRef.current = null;
    setGhost(null);
    setZone(null);
    setDraggingPath(null);
  }, [groups, onDragMove]);

  const onTabPointerDown = useCallback(
    (e: React.PointerEvent, gi: number, path: string) => {
      groups.focus(gi);
      dragRef.current = { path, gi, sx: e.clientX, sy: e.clientY, started: false, drop: null };
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragUp, { once: true });
    },
    [groups, onDragMove, onDragUp],
  );

  const onAddClick = useCallback(
    (gi: number) => {
      groups.focus(gi);
      setSearchOpen(true);
    },
    [groups],
  );

  const tree = useFileTree(session.folderPath, session.id);
  const gitStatuses = useGitFileStatuses({ sessionId: session.id, enabled: true });

  const dirtyMap: Record<string, boolean> = {};
  for (const [p, s] of Object.entries(tabStates)) dirtyMap[p] = s.dirty;

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
          {focusedPath ?? session.folderPath}
        </span>
        {focusedSnap?.dirty && <Chip dot="var(--dirty)">UNSAVED</Chip>}
        {focusedSnap?.saving && <Chip dot="var(--accent)">SAVING…</Chip>}
        <div style={{ flex: 1 }} />
        {isMd && focusedPath && (
          <SegmentedControl
            value={viewModeFor(focusedPath)}
            onChange={(v) => setViewModes((m) => ({ ...m, [focusedPath]: v }))}
          />
        )}
        <IconButton icon={Search} label="Search files (⌘K)" size="sm" onClick={() => setSearchOpen((o) => !o)} />
        <IconButton icon={RefreshCw} label="Refresh tree" size="sm" onClick={tree.refresh} />
        <Button
          variant={focusedSnap?.dirty ? 'primary' : 'ghost'}
          size="sm"
          icon={Save}
          onClick={() => void focusedSnap?.save()}
          disabled={!focusedSnap?.dirty || focusedSnap?.saving}
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
              selectedPath={focusedPath}
              onOpenFile={(path) => onPreviewFile(path)}
              onActivateFile={(path) => onPickFile(path)}
            />
          )}
          {searchOpen && (
            <FileSearchPanel
              key={searchQuery ?? ''}
              folderPath={session.folderPath}
              initialQuery={searchQuery}
              onSelectFile={(path, line) => onPickFile(path, line)}
              onClose={() => setSearchOpen(false)}
            />
          )}
        </aside>

        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {focusedSnap?.conflict && <ConflictBanner onReload={() => void focusedSnap?.reload()} />}
          <div ref={editorRef} style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
            {gstate.groups.map((g, gi) => (
              <Fragment key={gi}>
                <div
                  data-group={gi}
                  onPointerDown={() => groups.focus(gi)}
                  style={{
                    flex: isSplit ? (gi === 0 ? columnRatio : 1 - columnRatio) : 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                    boxShadow:
                      isSplit && gi === gstate.focused ? 'inset 0 2px 0 0 var(--accent-bg)' : 'none',
                  }}
                >
                  <EditorTabStrip
                    groupIndex={gi}
                    tabs={g.tabs}
                    active={g.active}
                    previewPath={g.preview}
                    draggingPath={draggingPath}
                    dirtyMap={dirtyMap}
                    onActivate={groups.activate}
                    onClose={groups.close}
                    onPin={groups.pin}
                    onTabPointerDown={onTabPointerDown}
                    onAddClick={onAddClick}
                  />
                  <div style={{ flex: 1, minHeight: 0, display: 'flex', background: 'var(--bg-inset)' }}>
                    {g.tabs.length === 0 ? (
                      <EmptyHint />
                    ) : (
                      g.tabs.map((path) => (
                        <EditorTab
                          key={path}
                          sessionId={session.id}
                          path={path}
                          visible={path === g.active}
                          theme={theme}
                          viewMode={viewModeFor(path)}
                          revealLine={reveal?.path === path ? reveal.line : undefined}
                          revealNonce={reveal?.path === path ? reveal.nonce : undefined}
                          onState={onTabState}
                          onUnmount={onTabUnmount}
                        />
                      ))
                    )}
                  </div>
                </div>
                {isSplit && gi === 0 && (
                  <ResizeDivider
                    isDragging={divDragging}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setDivDragging(true);
                    }}
                  />
                )}
              </Fragment>
            ))}

            {zone && (
              <div
                style={{
                  position: 'absolute',
                  left: zone.left,
                  top: zone.top,
                  width: zone.width,
                  height: zone.height,
                  background: 'var(--accent-bg)',
                  border: '2px dashed var(--accent-edge)',
                  borderRadius: 'var(--r-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                  zIndex: 5,
                }}
              >
                <span
                  className="eyebrow"
                  style={{
                    color: 'var(--accent)',
                    background: 'var(--bg-1)',
                    border: '1px solid var(--accent-edge)',
                    borderRadius: 'var(--r-2)',
                    padding: '6px 12px',
                    fontSize: 'var(--t-tiny)',
                  }}
                >
                  {zone.label}
                </span>
              </div>
            )}
          </div>
        </main>
      </div>

      {ghost && (
        <div
          style={{
            position: 'fixed',
            left: ghost.x + 12,
            top: ghost.y + 10,
            zIndex: 1000,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 11px',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-xs)',
            color: 'var(--fg-0)',
            background: 'var(--bg-3)',
            border: '1px solid var(--accent-edge)',
            borderRadius: 'var(--r-2)',
            boxShadow: 'var(--shadow-pop)',
            pointerEvents: 'none',
          }}
        >
          <span style={{ color: 'var(--accent)', fontSize: 'var(--t-tiny)' }}>TS</span>
          {ghost.label}
        </div>
      )}
    </div>
  );
}

function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

function readColumnRatio(): number {
  if (typeof window === 'undefined') return 0.5;
  const raw = window.localStorage.getItem(COLUMN_RATIO_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(0.8, Math.max(0.2, n));
}

function EmptyHint() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--fg-3)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-sm)',
      }}
    >
      Pick a file from the tree.
    </div>
  );
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
