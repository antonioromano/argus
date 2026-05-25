import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light';
import tsxLang from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescriptLang from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import javascriptLang from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import jsxLang from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import jsonLang from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import cssLang from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import scssLang from 'react-syntax-highlighter/dist/esm/languages/prism/scss';
import lessLang from 'react-syntax-highlighter/dist/esm/languages/prism/less';
import markupLang from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import bashLang from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import pythonLang from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import rubyLang from 'react-syntax-highlighter/dist/esm/languages/prism/ruby';
import rustLang from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import goLang from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import javaLang from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import cLang from 'react-syntax-highlighter/dist/esm/languages/prism/c';
import cppLang from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import csharpLang from 'react-syntax-highlighter/dist/esm/languages/prism/csharp';
import phpLang from 'react-syntax-highlighter/dist/esm/languages/prism/php';
import swiftLang from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import kotlinLang from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin';
import yamlLang from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import tomlLang from 'react-syntax-highlighter/dist/esm/languages/prism/toml';
import markdownLang from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import sqlLang from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import graphqlLang from 'react-syntax-highlighter/dist/esm/languages/prism/graphql';
import hclLang from 'react-syntax-highlighter/dist/esm/languages/prism/hcl';
import dockerLang from 'react-syntax-highlighter/dist/esm/languages/prism/docker';
import makefileLang from 'react-syntax-highlighter/dist/esm/languages/prism/makefile';
import { syntaxTheme } from '../utils/syntaxTheme.js';
import { langFromPath } from '../utils/langFromPath.js';
import {
  FolderOpen, FileText, File,
  RefreshCw, Copy, Check, Link, BookOpen, Code, Pencil,
  Save, X as XIcon, PanelLeft, PanelLeftClose,
  Terminal as TerminalIcon, GitCommit, ExternalLink,
  FilePlus, Eye, EyeOff,
} from 'lucide-react';
import type { Socket } from 'socket.io-client';
import type {
  SessionInfo, FileContentResponse, GitFileStatusCode,
  DirectoryEntry, ClientToServerEvents, ServerToClientEvents,
} from '@argus/shared';
import type { TreeNode } from '../hooks/useVirtualTree.js';
import { SessionSidebar } from './SessionSidebar.js';
import { ResizeDivider } from './ResizeDivider.js';
import { EphemeralTerminal } from './EphemeralTerminal.js';
import { Tooltip } from './primitives/Tooltip.js';
import { InlineIconLink } from './primitives/InlineIconLink.js';
import { MacAlertSheet } from './mac/MacAlertSheet.js';
import { useResizablePanel } from '../hooks/useResizablePanel.js';
import { api } from '../services/api.js';
import { VirtualFileTree } from './explorer/VirtualFileTree.js';
import { FileTreeRow } from './explorer/FileTreeRow.js';
import { ExplorerContextMenu, type ContextMenuAction } from './explorer/ExplorerContextMenu.js';
import { InlineNameInput } from './explorer/InlineNameInput.js';
import { ConfirmActionDialog } from './explorer/ConfirmActionDialog.js';
import type { VirtualRow } from '../hooks/useVirtualTree.js';

SyntaxHighlighter.registerLanguage('tsx', tsxLang);
SyntaxHighlighter.registerLanguage('typescript', typescriptLang);
SyntaxHighlighter.registerLanguage('javascript', javascriptLang);
SyntaxHighlighter.registerLanguage('jsx', jsxLang);
SyntaxHighlighter.registerLanguage('json', jsonLang);
SyntaxHighlighter.registerLanguage('css', cssLang);
SyntaxHighlighter.registerLanguage('scss', scssLang);
SyntaxHighlighter.registerLanguage('less', lessLang);
SyntaxHighlighter.registerLanguage('markup', markupLang);
SyntaxHighlighter.registerLanguage('bash', bashLang);
SyntaxHighlighter.registerLanguage('python', pythonLang);
SyntaxHighlighter.registerLanguage('ruby', rubyLang);
SyntaxHighlighter.registerLanguage('rust', rustLang);
SyntaxHighlighter.registerLanguage('go', goLang);
SyntaxHighlighter.registerLanguage('java', javaLang);
SyntaxHighlighter.registerLanguage('c', cLang);
SyntaxHighlighter.registerLanguage('cpp', cppLang);
SyntaxHighlighter.registerLanguage('csharp', csharpLang);
SyntaxHighlighter.registerLanguage('php', phpLang);
SyntaxHighlighter.registerLanguage('swift', swiftLang);
SyntaxHighlighter.registerLanguage('kotlin', kotlinLang);
SyntaxHighlighter.registerLanguage('yaml', yamlLang);
SyntaxHighlighter.registerLanguage('toml', tomlLang);
SyntaxHighlighter.registerLanguage('markdown', markdownLang);
SyntaxHighlighter.registerLanguage('sql', sqlLang);
SyntaxHighlighter.registerLanguage('graphql', graphqlLang);
SyntaxHighlighter.registerLanguage('hcl', hclLang);
SyntaxHighlighter.registerLanguage('docker', dockerLang);
SyntaxHighlighter.registerLanguage('makefile', makefileLang);

const NARROW_BREAKPOINT = 520;

const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('electron');

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// ─── Props interface (UNCHANGED from original ExplorerPanel) ──────────────────

interface ExplorerPanelProps {
  sessions: SessionInfo[];
  theme: 'dark' | 'light';
  onSelectSession?: (id: string) => void;
  focusedSessionId?: string | null;
  initialFilePath?: string | null;
  initialSearchQuery?: string;
  onExplorerStateChange?: (state: { selectedFilePath: string | null; searchQuery: string }) => void;
  socket?: TypedSocket;
  /** When true, hides SessionSidebar and uses 100% height (for Dashboard split view). */
  embedded?: boolean;
  onOpenInDiff?: (fileName?: string) => void;
  /** Cached expanded paths for the tree (survives tab switches). */
  treeExpandedPaths?: Map<string, Set<string>>;
  /** Cached tree data (survives tab switches). */
  treeDataCache?: Map<string, Map<string, TreeNode>>;
  /** Called when expanded paths change — parent can cache. */
  onTreeExpandedPathsChange?: (sessionId: string, paths: Set<string>) => void;
  /** Called when tree data changes — parent can cache. */
  onTreeDataChange?: (sessionId: string, data: Map<string, TreeNode>) => void;
  /** Whether the shared terminal is open. */
  showTerminal?: boolean;
  /** Toggle the shared terminal. */
  onToggleTerminal?: () => void;
}

// ─── Small helpers ─────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Inline-create virtual row ─────────────────────────────────────────────────
// Rendered as an extra 22px row injected at depth 0 (root level) when creating
// a new file/folder at the session root.  The VirtualFileTree itself doesn't know
// about it — we place it above the tree as a standalone DOM element.
interface InlineCreateRowProps {
  isDir: boolean;
  siblingNames: string[];
  onConfirm: (name: string) => Promise<void>;
  onCancel: () => void;
}

function InlineCreateRow({ isDir, siblingNames, onConfirm, onCancel }: InlineCreateRowProps) {
  return (
    <div style={{ borderBottom: '1px solid var(--color-border-base)' }}>
      <InlineNameInput
        initialValue=""
        siblingNames={siblingNames}
        onConfirm={onConfirm}
        onCancel={onCancel}
        depth={0}
        isDir={isDir}
      />
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ExplorerPanel({
  sessions,
  theme,
  onSelectSession,
  focusedSessionId,
  initialFilePath,
  initialSearchQuery,
  onExplorerStateChange,
  socket,
  embedded,
  onOpenInDiff,
  treeExpandedPaths: _treeExpandedPaths,
  treeDataCache: _treeDataCache,
  onTreeExpandedPathsChange: _onTreeExpandedPathsChange,
  onTreeDataChange: _onTreeDataChange,
  showTerminal: showTerminalProp,
  onToggleTerminal,
}: ExplorerPanelProps) {

  // ── Session selection ────────────────────────────────────────────────────────
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // treeKey: bump to force VirtualFileTree remount (triggers refetch)
  const [treeKey, setTreeKey] = useState(0);

  // ── File preview state ───────────────────────────────────────────────────────
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(initialFilePath ?? null);
  const [selectedExt, setSelectedExt] = useState<string>('');
  const [fileContent, setFileContent] = useState<FileContentResponse | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mdPreview, setMdPreview] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [originalMtimeMs, setOriginalMtimeMs] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const pendingNavRef = useRef<(() => void) | null>(null);

  // ── Toast ────────────────────────────────────────────────────────────────────
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Toolbar filter state ─────────────────────────────────────────────────────
  const [filterQuery, setFilterQuery] = useState('');
  const [showUntracked, setShowUntracked] = useState(true);
  const [showIgnored, setShowIgnored] = useState(false);

  // ── Git status ───────────────────────────────────────────────────────────────
  // gitStatusMap is keyed by RELATIVE paths (relative to gitRoot) from API
  const [gitStatusMap, setGitStatusMap] = useState<Record<string, GitFileStatusCode>>({});
  const [gitRoot, setGitRoot] = useState<string>('');
  const gitStatusFetchIdRef = useRef(0);

  // ── Context menu ─────────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{ entry: DirectoryEntry; position: { x: number; y: number } } | null>(null);

  // ── Inline create/rename ──────────────────────────────────────────────────────
  const [inlineCreate, setInlineCreate] = useState<{ parentPath: string; isDir: boolean } | null>(null);
  const [inlineRename, setInlineRename] = useState<{ entry: DirectoryEntry } | null>(null);

  // ── Confirm dialogs ───────────────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState<{ entry: DirectoryEntry } | null>(null);
  const [confirmRevert, setConfirmRevert] = useState<{ entry: DirectoryEntry } | null>(null);

  // ── Layout refs & state ───────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const treePanelRef = useRef<HTMLDivElement>(null);
  const fetchIdRef = useRef(0);
  const [isNarrow, setIsNarrow] = useState(false);
  const [isTreeVisible, setIsTreeVisible] = useState(true);

  // Terminal state: prefer prop-based shared terminal when available
  const [showTerminalLocal, setShowTerminalLocal] = useState(false);
  const showTerminal = showTerminalProp ?? showTerminalLocal;
  const toggleTerminal = onToggleTerminal ?? (() => setShowTerminalLocal(t => !t));

  // ── Resizable panels ──────────────────────────────────────────────────────────
  const { size: sidebarWidth, isDragging: isSidebarDragging, handleMouseDown: handleSidebarMouseDown } = useResizablePanel({
    containerRef,
    defaultSize: 200,
    minSize: 120,
    maxSize: 350,
    direction: 'left',
    unit: 'px',
    storageKey: 'explorer-sidebar-width',
  });

  const { size: treeWidth, isDragging: isTreeDragging, handleMouseDown: handleTreeMouseDown } = useResizablePanel({
    containerRef: treePanelRef,
    defaultSize: 260,
    minSize: 150,
    maxSize: 500,
    direction: 'left',
    unit: 'px',
    storageKey: 'explorer-tree-width-v2',
  });

  // ── Narrow breakpoint observer ────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setIsNarrow(entries[0].contentRect.width < NARROW_BREAKPOINT);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Auto-select session ───────────────────────────────────────────────────────
  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }
    if (embedded && focusedSessionId && sessions.find(s => s.id === focusedSessionId)) {
      setSelectedSessionId(focusedSessionId);
      return;
    }
    if (!selectedSessionId || !sessions.find(s => s.id === selectedSessionId)) {
      const initialId = (focusedSessionId && sessions.find(s => s.id === focusedSessionId))
        ? focusedSessionId
        : sessions[0].id;
      setSelectedSessionId(initialId);
    }
  }, [sessions, selectedSessionId, focusedSessionId, embedded]);

  // ── Git status fetcher ────────────────────────────────────────────────────────
  const refreshGitStatus = useCallback(() => {
    if (!selectedSessionId) {
      setGitStatusMap({});
      setGitRoot('');
      return;
    }
    const id = ++gitStatusFetchIdRef.current;
    api.getGitFileStatuses(selectedSessionId).then(response => {
      if (gitStatusFetchIdRef.current !== id) return;
      if (!response.gitRoot) {
        setGitStatusMap({});
        setGitRoot('');
        return;
      }
      setGitRoot(response.gitRoot);
      // Store the raw relative-path map (keyed by path relative to gitRoot)
      const relMap: Record<string, GitFileStatusCode> = {};
      for (const [relPath, status] of Object.entries(response.statuses)) {
        relMap[relPath] = status;
      }
      setGitStatusMap(relMap);
    }).catch(() => {
      if (gitStatusFetchIdRef.current === id) {
        setGitStatusMap({});
        setGitRoot('');
      }
    });
  }, [selectedSessionId]);

  useEffect(() => {
    refreshGitStatus();
  }, [refreshGitStatus, treeKey]);

  // ── Initial file content load (restores across tab switches) ─────────────────
  useEffect(() => {
    if (!initialFilePath) return;
    const id = ++fetchIdRef.current;
    setFileLoading(true);
    api.getFileContent(initialFilePath).then(content => {
      if (fetchIdRef.current === id) {
        setFileContent(content);
        setOriginalMtimeMs(content.mtimeMs);
        setFileLoading(false);
      }
    }).catch(err => {
      if (fetchIdRef.current === id) {
        setFileError(err instanceof Error ? err.message : 'Failed to load file');
        setFileLoading(false);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

  // ── Sync navigation state back to parent ──────────────────────────────────────
  useEffect(() => {
    onExplorerStateChange?.({ selectedFilePath, searchQuery: filterQuery });
  }, [selectedFilePath, filterQuery, onExplorerStateChange]);

  // ── Restore initial search query ──────────────────────────────────────────────
  useEffect(() => {
    if (initialSearchQuery) setFilterQuery(initialSearchQuery);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

  // ── Toast helper ─────────────────────────────────────────────────────────────
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 1800);
  }, []);

  // ── Session navigation helpers ────────────────────────────────────────────────
  const doSessionSelect = useCallback((id: string) => {
    setSelectedSessionId(id);
    setSelectedFilePath(null);
    setSelectedExt('');
    setFileContent(null);
    setFileError(null);
    setFilterQuery('');
    setIsEditMode(false);
    setEditContent('');
    setOriginalMtimeMs(null);
    onSelectSession?.(id);
  }, [onSelectSession]);

  const handleSessionSelect = useCallback((id: string) => {
    if (isEditMode && editContent !== fileContent?.content) {
      pendingNavRef.current = () => doSessionSelect(id);
      setShowUnsavedModal(true);
    } else {
      doSessionSelect(id);
    }
  }, [isEditMode, editContent, fileContent, doSessionSelect]);

  // ── File select helpers ───────────────────────────────────────────────────────
  const doFileSelect = useCallback(async (filePath: string, ext: string) => {
    const id = ++fetchIdRef.current;
    setSelectedFilePath(filePath);
    setSelectedExt(ext);
    setFileContent(null);
    setFileError(null);
    setFileLoading(true);
    setMdPreview(false);
    setIsEditMode(false);
    setEditContent('');
    setOriginalMtimeMs(null);
    if (isNarrow) setIsTreeVisible(false);
    try {
      const content = await api.getFileContent(filePath);
      if (fetchIdRef.current === id) {
        setFileContent(content);
        setOriginalMtimeMs(content.mtimeMs);
      }
    } catch (err) {
      if (fetchIdRef.current === id) {
        setFileError(err instanceof Error ? err.message : 'Failed to load file');
      }
    } finally {
      if (fetchIdRef.current === id) setFileLoading(false);
    }
  }, [isNarrow]);

  const handleFileSelect = useCallback((filePath: string, ext: string) => {
    if (isEditMode && editContent !== fileContent?.content) {
      pendingNavRef.current = () => doFileSelect(filePath, ext);
      setShowUnsavedModal(true);
    } else {
      doFileSelect(filePath, ext);
    }
  }, [isEditMode, editContent, fileContent, doFileSelect]);

  // ── Clipboard helpers ─────────────────────────────────────────────────────────
  const handleCopy = useCallback(() => {
    const text = isEditMode ? editContent : fileContent?.content;
    if (text === undefined) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast('Content copied');
    });
  }, [isEditMode, editContent, fileContent, showToast]);

  const handleCopyFilePath = useCallback(() => {
    if (!selectedFilePath) return;
    navigator.clipboard.writeText(selectedFilePath).then(() => showToast('File path copied'));
  }, [selectedFilePath, showToast]);

  const handleOpenPath = useCallback((entryPath: string) => {
    if (!selectedSessionId) return;
    api.openPath(selectedSessionId, entryPath).catch((err: Error) => {
      showToast(err.message || 'Failed to open', 'error');
    });
  }, [selectedSessionId, showToast]);

  // ── Edit mode helpers ─────────────────────────────────────────────────────────
  const handleEnterEdit = useCallback(() => {
    if (!fileContent) return;
    setEditContent(fileContent.content);
    setIsEditMode(true);
  }, [fileContent]);

  const handleCancelEdit = useCallback(() => {
    const isDirty = editContent !== fileContent?.content;
    if (isDirty) {
      pendingNavRef.current = () => {
        setIsEditMode(false);
        setEditContent('');
      };
      setShowUnsavedModal(true);
    } else {
      setIsEditMode(false);
      setEditContent('');
    }
  }, [editContent, fileContent]);

  const handleSave = useCallback(async (overwrite = false) => {
    if (!selectedFilePath || !selectedSessionId) return;
    setIsSaving(true);
    try {
      const result = await api.writeFile({
        sessionId: selectedSessionId,
        path: selectedFilePath,
        content: editContent,
        originalMtimeMs: overwrite ? undefined : (originalMtimeMs ?? undefined),
      });
      if (result.conflict) {
        setShowConflictModal(true);
        return;
      }
      if (!result.success) {
        showToast(result.error ?? 'Save failed', 'error');
        return;
      }
      setOriginalMtimeMs(result.mtimeMs);
      setFileContent(prev => prev ? { ...prev, content: editContent, size: result.size, mtimeMs: result.mtimeMs } : prev);
      setIsEditMode(false);
      showToast('File saved');
    } catch {
      showToast('Save failed — network error', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [selectedFilePath, selectedSessionId, editContent, originalMtimeMs, showToast]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isEditMode) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        handleCancelEdit();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [isEditMode, handleSave, handleCancelEdit]);

  // Warn on browser close when dirty
  useEffect(() => {
    const isDirty = isEditMode && editContent !== fileContent?.content;
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isEditMode, editContent, fileContent]);

  // ── Context menu action handler ───────────────────────────────────────────────
  const handleContextAction = useCallback(async (action: ContextMenuAction) => {
    const session = sessions.find(s => s.id === selectedSessionId);
    if (!session) return;
    const contextEntry = contextMenu?.entry;

    // Helper: get relative path from session folder root
    const relPath = (entry: DirectoryEntry) =>
      entry.path.startsWith(session.folderPath + '/')
        ? entry.path.slice(session.folderPath.length + 1)
        : entry.path;

    switch (action.type) {
      case 'open':
        if (contextEntry) {
          if (contextEntry.isFile) {
            handleFileSelect(contextEntry.path, contextEntry.ext);
          } else {
            handleOpenPath(contextEntry.path);
          }
        }
        break;

      case 'copy-path':
        if (contextEntry) {
          navigator.clipboard.writeText(contextEntry.path).catch(() => {});
        }
        break;

      case 'copy-name':
        if (contextEntry) {
          navigator.clipboard.writeText(contextEntry.name).catch(() => {});
        }
        break;

      case 'reveal':
        if (contextEntry) {
          handleOpenPath(contextEntry.path);
        }
        break;

      case 'new-file':
        setInlineCreate({ parentPath: action.parentPath, isDir: false });
        break;

      case 'new-folder':
        setInlineCreate({ parentPath: action.parentPath, isDir: true });
        break;

      case 'rename':
        if (contextEntry) {
          setInlineRename({ entry: contextEntry });
        }
        break;

      case 'delete':
        if (contextEntry) {
          setConfirmDelete({ entry: contextEntry });
        }
        break;

      case 'show-diff':
        if (contextEntry) {
          onOpenInDiff?.(contextEntry.name);
        }
        break;

      case 'stage':
        if (contextEntry) {
          try {
            await api.gitAdd(session.id, relPath(contextEntry));
            refreshGitStatus();
          } catch {
            showToast('Failed to stage file', 'error');
          }
        }
        break;

      case 'unstage':
        if (contextEntry) {
          try {
            await api.gitUnstage(session.id, relPath(contextEntry));
            refreshGitStatus();
          } catch {
            showToast('Failed to unstage file', 'error');
          }
        }
        break;

      case 'track':
        if (contextEntry) {
          try {
            await api.gitAdd(session.id, relPath(contextEntry));
            refreshGitStatus();
          } catch {
            showToast('Failed to track file', 'error');
          }
        }
        break;

      case 'revert-to-head':
        if (contextEntry) {
          setConfirmRevert({ entry: contextEntry });
        }
        break;

      case 'add-to-gitignore':
        if (contextEntry) {
          try {
            await api.gitIgnore(session.id, relPath(contextEntry));
            refreshGitStatus();
          } catch {
            showToast('Failed to add to .gitignore', 'error');
          }
        }
        break;
    }
  }, [sessions, selectedSessionId, contextMenu, handleFileSelect, handleOpenPath, onOpenInDiff, refreshGitStatus, showToast]);

  // ── Inline create confirm ─────────────────────────────────────────────────────
  const handleInlineCreateConfirm = useCallback(async (name: string) => {
    const session = sessions.find(s => s.id === selectedSessionId);
    if (!session || !inlineCreate) return;
    const newPath = inlineCreate.parentPath + '/' + name;
    try {
      const result = await api.createFile(session.id, newPath, inlineCreate.isDir);
      if (!result.success) {
        showToast(result.error ?? 'Failed to create', 'error');
        return;
      }
      setInlineCreate(null);
      setTreeKey(k => k + 1);
      refreshGitStatus();
      if (!inlineCreate.isDir) {
        handleFileSelect(newPath, '.' + name.split('.').pop()!);
      }
    } catch {
      showToast('Failed to create', 'error');
    }
  }, [sessions, selectedSessionId, inlineCreate, showToast, refreshGitStatus, handleFileSelect]);

  // ── Inline rename confirm ─────────────────────────────────────────────────────
  const handleInlineRenameConfirm = useCallback(async (name: string) => {
    const session = sessions.find(s => s.id === selectedSessionId);
    if (!session || !inlineRename) return;
    const oldPath = inlineRename.entry.path;
    const newPath = oldPath.replace(/[^/]+$/, name);
    try {
      const result = await api.renameFile(session.id, oldPath, newPath);
      if (!result.success) {
        showToast(result.error ?? 'Failed to rename', 'error');
        return;
      }
      setInlineRename(null);
      setTreeKey(k => k + 1);
      refreshGitStatus();
      // Update selected file path if the renamed file was selected
      if (selectedFilePath === oldPath) {
        setSelectedFilePath(newPath);
      }
    } catch {
      showToast('Failed to rename', 'error');
    }
  }, [sessions, selectedSessionId, inlineRename, showToast, refreshGitStatus, selectedFilePath]);

  // ── Delete confirm ────────────────────────────────────────────────────────────
  const handleDeleteConfirm = useCallback(async () => {
    const session = sessions.find(s => s.id === selectedSessionId);
    if (!session || !confirmDelete) return;
    try {
      const result = await api.deleteFile(session.id, confirmDelete.entry.path);
      if (!result.success) {
        showToast(result.error ?? 'Failed to delete', 'error');
        return;
      }
      if (selectedFilePath === confirmDelete.entry.path) {
        setSelectedFilePath(null);
        setFileContent(null);
        setFileError(null);
      }
      setConfirmDelete(null);
      setTreeKey(k => k + 1);
      refreshGitStatus();
    } catch {
      showToast('Failed to delete', 'error');
    }
  }, [sessions, selectedSessionId, confirmDelete, selectedFilePath, showToast, refreshGitStatus]);

  // ── Revert confirm ────────────────────────────────────────────────────────────
  const handleRevertConfirm = useCallback(async () => {
    const session = sessions.find(s => s.id === selectedSessionId);
    if (!session || !confirmRevert) return;
    const relPath = confirmRevert.entry.path.startsWith(session.folderPath + '/')
      ? confirmRevert.entry.path.slice(session.folderPath.length + 1)
      : confirmRevert.entry.path;
    try {
      const result = await api.revertFileToHead(session.id, relPath);
      if (!result.success) {
        showToast(result.error ?? 'Failed to revert', 'error');
        return;
      }
      setConfirmRevert(null);
      // Reload file content if it was being previewed
      if (selectedFilePath === confirmRevert.entry.path) {
        doFileSelect(confirmRevert.entry.path, selectedExt);
      }
      refreshGitStatus();
    } catch {
      showToast('Failed to revert', 'error');
    }
  }, [sessions, selectedSessionId, confirmRevert, selectedFilePath, selectedExt, doFileSelect, showToast, refreshGitStatus]);

  // ── Derived values ────────────────────────────────────────────────────────────
  const selectedSession = sessions.find(s => s.id === selectedSessionId);
  const isMd = selectedFilePath?.toLowerCase().endsWith('.md') ?? false;
  const isDirty = isEditMode && editContent !== fileContent?.content;

  const language = useMemo(
    () => selectedFilePath ? langFromPath(selectedFilePath) : undefined,
    [selectedFilePath],
  );
  const lineCount = useMemo(
    () => fileContent?.content.split('\n').length ?? 0,
    [fileContent],
  );
  const tooManyLines = lineCount > 5000;
  const tooLargeBytes = (fileContent?.size ?? 0) > 200_000;
  const useHighlight = !!language && !tooManyLines && !tooLargeBytes;

  // Build an absolute-path keyed git status map for passing to VirtualFileTree
  // VirtualFileTree/useVirtualTree expects paths relative to the rootPath (gitRoot),
  // which matches what api.getGitFileStatuses returns.
  const absoluteGitStatusMap = useMemo<Record<string, GitFileStatusCode>>(() => {
    if (!gitRoot) return {};
    const result: Record<string, GitFileStatusCode> = {};
    for (const [relPath, status] of Object.entries(gitStatusMap)) {
      result[relPath] = status;
    }
    return result;
  }, [gitStatusMap, gitRoot]);

  // Get the git status for the currently right-clicked entry (for the context menu)
  const contextEntryGitStatus = useMemo<GitFileStatusCode | undefined>(() => {
    if (!contextMenu || !gitRoot) return undefined;
    const entry = contextMenu.entry;
    const relKey = entry.path.startsWith(gitRoot + '/')
      ? entry.path.slice(gitRoot.length + 1)
      : entry.path;
    return gitStatusMap[relKey] as GitFileStatusCode | undefined;
  }, [contextMenu, gitStatusMap, gitRoot]);

  // ── renderRow callback for VirtualFileTree ────────────────────────────────────
  const renderRow = useCallback((
    row: VirtualRow,
    isSelected: boolean,
    onToggleExpand: (path: string) => Promise<void>,
  ) => {
    // If this row is being renamed, show InlineNameInput instead
    if (inlineRename?.entry.path === row.entry.path) {
      // Get sibling names from the parent directory
      return (
        <InlineNameInput
          initialValue={row.entry.name}
          siblingNames={[]} // simplified — duplicate check still works via backend
          onConfirm={handleInlineRenameConfirm}
          onCancel={() => setInlineRename(null)}
          depth={row.depth}
          isDir={!row.entry.isFile}
        />
      );
    }

    return (
      <FileTreeRow
        row={row}
        isSelected={isSelected}
        onClick={() => {
          if (row.entry.isFile) {
            handleFileSelect(row.entry.path, row.entry.ext);
          } else {
            void onToggleExpand(row.entry.path);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ entry: row.entry, position: { x: e.clientX, y: e.clientY } });
        }}
        onToggleExpand={onToggleExpand}
      />
    );
  }, [inlineRename, handleFileSelect, handleInlineRenameConfirm]);

  // ── Empty state ───────────────────────────────────────────────────────────────
  if (sessions.length === 0) {
    return (
      <div style={{
        height: embedded ? '100%' : `calc(100vh - var(--header-height) - var(--nav-tabs-height) - var(--shared-terminal-height, 0px))`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        color: 'var(--color-text-muted)',
      }}>
        <FolderOpen size={40} strokeWidth={1} />
        <span style={{ fontSize: 'var(--text-md)' }}>No sessions — create a session to use Explorer</span>
      </div>
    );
  }

  // ── File preview panel (UNCHANGED from original ExplorerPanel) ────────────────
  const filePreviewPanel = (
    <div style={{
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: 'var(--color-bg-base)',
    }}>
      {!selectedFilePath ? (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          color: 'var(--color-text-muted)',
        }}>
          <FileText size={36} strokeWidth={1} />
          <span style={{ fontSize: 'var(--text-sm)' }}>Select a file to preview</span>
        </div>
      ) : (
        <>
          {/* Preview header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 14px',
            borderBottom: '1px solid var(--color-border-base)',
            flexShrink: 0,
            background: 'var(--color-bg-header)',
            minHeight: '36px',
          }}>
            <span style={{
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-text-primary)',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}>
              {selectedFilePath.split('/').pop()}
              {isDirty && <span style={{ color: 'var(--color-text-muted)', marginLeft: 4 }}>●</span>}
            </span>
            {isEditMode ? (
              /* Edit mode toolbar */
              <>
                <Tooltip content="Save (Ctrl+S)" position="bottom">
                  <button
                    onClick={() => handleSave()}
                    disabled={isSaving}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: 'var(--color-accent)',
                      border: 'none',
                      cursor: isSaving ? 'not-allowed' : 'pointer',
                      padding: '3px 8px',
                      borderRadius: 'var(--radius-sm)',
                      color: '#fff',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 600,
                      opacity: isSaving ? 0.6 : 1,
                      flexShrink: 0,
                    }}
                  >
                    <Save size={12} strokeWidth={2} />
                    {isSaving ? 'Saving…' : 'Save'}
                  </button>
                </Tooltip>
                <Tooltip content="Cancel (Esc)" position="bottom">
                  <button
                    onClick={handleCancelEdit}
                    disabled={isSaving}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: 'none',
                      border: '1px solid var(--color-border-base)',
                      cursor: 'pointer',
                      padding: '3px 8px',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-secondary)',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 500,
                      flexShrink: 0,
                    }}
                  >
                    <XIcon size={12} strokeWidth={2} />
                    Cancel
                  </button>
                </Tooltip>
              </>
            ) : (
              /* View mode buttons */
              fileContent && (
                <>
                  <span style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-muted)',
                    background: 'var(--color-bg-elevated)',
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-sm)',
                    fontFamily: 'var(--font-mono)',
                    flexShrink: 0,
                  }}>
                    {formatSize(fileContent.size)}
                  </span>
                  <Tooltip content="Copy file content" position="bottom">
                    <button
                      onClick={handleCopy}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'inline-flex',
                        borderRadius: 'var(--radius-sm)',
                        color: copied ? 'var(--color-accent)' : 'var(--color-text-muted)',
                        transition: 'color var(--transition-fast)',
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                      onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                    >
                      {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.75} />}
                    </button>
                  </Tooltip>
                  {isMd && (
                    <Tooltip content={mdPreview ? 'View raw' : 'Preview markdown'} position="bottom">
                      <button
                        onClick={() => setMdPreview(p => !p)}
                        style={{
                          background: mdPreview ? 'var(--color-accent-subtle)' : 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '2px',
                          display: 'inline-flex',
                          borderRadius: 'var(--radius-sm)',
                          color: mdPreview ? 'var(--color-accent)' : 'var(--color-text-muted)',
                          transition: 'color var(--transition-fast)',
                          flexShrink: 0,
                        }}
                        onMouseEnter={(e) => { if (!mdPreview) e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                        onMouseLeave={(e) => { if (!mdPreview) e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                      >
                        {mdPreview ? <Code size={13} strokeWidth={1.75} /> : <BookOpen size={13} strokeWidth={1.75} />}
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip content={fileContent.truncated ? 'File too large to edit' : 'Edit file'} position="bottom">
                    <button
                      onClick={handleEnterEdit}
                      disabled={fileContent.truncated}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: fileContent.truncated ? 'not-allowed' : 'pointer',
                        padding: '2px',
                        display: 'inline-flex',
                        borderRadius: 'var(--radius-sm)',
                        color: fileContent.truncated ? 'var(--color-text-disabled, var(--color-text-muted))' : 'var(--color-text-muted)',
                        opacity: fileContent.truncated ? 0.4 : 1,
                        transition: 'color var(--transition-fast)',
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => { if (!fileContent.truncated) e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                      onMouseLeave={(e) => { if (!fileContent.truncated) e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                    >
                      <Pencil size={13} strokeWidth={1.75} />
                    </button>
                  </Tooltip>
                  {selectedFilePath && (
                    <InlineIconLink
                      icon={ExternalLink}
                      label={`Open ${selectedFilePath.split('/').pop()} with default app`}
                      onClick={() => handleOpenPath(selectedFilePath)}
                    />
                  )}
                  {onOpenInDiff && selectedFilePath && gitStatusMap[
                    selectedFilePath.startsWith(gitRoot + '/') ? selectedFilePath.slice(gitRoot.length + 1) : selectedFilePath
                  ] && gitStatusMap[
                    selectedFilePath.startsWith(gitRoot + '/') ? selectedFilePath.slice(gitRoot.length + 1) : selectedFilePath
                  ] !== '!!' && (
                    <InlineIconLink icon={GitCommit} label="View in Diff" onClick={() => onOpenInDiff(selectedFilePath.split('/').pop())} />
                  )}
                </>
              )
            )}
            {isNarrow && selectedFilePath && !isEditMode && (
              <Tooltip content="Copy file path" position="bottom">
                <button
                  onClick={handleCopyFilePath}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'inline-flex',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-muted)',
                    transition: 'color var(--transition-fast)',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                >
                  <Link size={13} strokeWidth={1.75} />
                </button>
              </Tooltip>
            )}
          </div>

          {/* Preview content */}
          <div style={{ flex: 1, overflow: isEditMode ? 'hidden' : 'auto', position: 'relative', display: 'flex', flexDirection: 'column' }}>
            {fileLoading && (
              <div style={{
                padding: '24px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}>
                {[95, 80, 60, 88, 70, 50, 75].map((w, i) => (
                  <div key={i} style={{
                    height: '16px',
                    background: 'var(--color-bg-elevated)',
                    borderRadius: 'var(--radius-sm)',
                    width: `${w}%`,
                    opacity: 0.5,
                  }} />
                ))}
              </div>
            )}

            {!fileLoading && fileError === 'binary' && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                height: '100%',
                color: 'var(--color-text-muted)',
              }}>
                <File size={36} strokeWidth={1} />
                <span style={{ fontSize: 'var(--text-sm)' }}>Binary file — preview not available</span>
                <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
                  {selectedFilePath.split('/').pop()}
                </span>
              </div>
            )}

            {!fileLoading && fileError && fileError !== 'binary' && (
              <div style={{
                padding: '16px',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-status-error, #f7768e)',
              }}>
                {fileError}
              </div>
            )}

            {!fileLoading && fileContent && (
              <>
                {fileContent.truncated && (
                  <div style={{
                    padding: '6px 14px',
                    fontSize: 'var(--text-xs)',
                    background: 'rgba(224, 175, 104, 0.1)',
                    color: 'var(--color-status-warning, #e0af68)',
                    borderBottom: '1px solid var(--color-border-base)',
                    flexShrink: 0,
                  }}>
                    Showing first 512 KB — file truncated
                  </div>
                )}
                {isEditMode ? (
                  <textarea
                    autoFocus
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Tab') {
                        e.preventDefault();
                        const start = e.currentTarget.selectionStart;
                        const end = e.currentTarget.selectionEnd;
                        const next = editContent.substring(0, start) + '  ' + editContent.substring(end);
                        setEditContent(next);
                        requestAnimationFrame(() => {
                          const el = e.currentTarget;
                          el.selectionStart = start + 2;
                          el.selectionEnd = start + 2;
                        });
                      }
                    }}
                    style={{
                      flex: 1,
                      width: '100%',
                      minHeight: 0,
                      margin: 0,
                      padding: '16px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-sm)',
                      lineHeight: 1.6,
                      color: 'var(--color-text-primary)',
                      background: 'var(--color-bg-code)',
                      border: 'none',
                      outline: 'none',
                      resize: 'none',
                      boxSizing: 'border-box',
                      whiteSpace: 'pre',
                      overflow: 'auto',
                    }}
                    spellCheck={false}
                  />
                ) : isMd && mdPreview ? (
                  <div style={{
                    padding: '16px 20px',
                    fontSize: 'var(--text-sm)',
                    lineHeight: 1.7,
                    color: 'var(--color-text-primary)',
                    maxWidth: '80ch',
                  }} className="md-preview">
                    <ReactMarkdown>{fileContent.content}</ReactMarkdown>
                  </div>
                ) : (
                  <>
                    {!!language && (tooManyLines || tooLargeBytes) && (
                      <div style={{
                        padding: '6px 14px',
                        fontSize: 'var(--text-xs)',
                        background: 'rgba(224, 175, 104, 0.1)',
                        color: 'var(--color-status-warning, #e0af68)',
                        borderBottom: '1px solid var(--color-border-base)',
                        flexShrink: 0,
                      }}>
                        File too large for syntax highlighting — showing plain text
                      </div>
                    )}
                    {useHighlight ? (
                      <SyntaxHighlighter
                        language={language}
                        style={syntaxTheme}
                        showLineNumbers
                        lineNumberStyle={{
                          minWidth: '2.5em',
                          paddingRight: '1em',
                          color: 'var(--color-text-muted)',
                          userSelect: 'none' as const,
                          fontSize: 'var(--text-xs)',
                        }}
                        customStyle={{
                          margin: 0,
                          padding: '16px',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-sm)',
                          lineHeight: 1.6,
                          background: 'var(--color-bg-code)',
                          borderRadius: 0,
                          overflowX: 'auto',
                          whiteSpace: 'pre',
                        }}
                        wrapLongLines={false}
                      >
                        {fileContent.content}
                      </SyntaxHighlighter>
                    ) : (
                      <pre style={{
                        margin: 0,
                        padding: '16px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-sm)',
                        lineHeight: 1.6,
                        color: 'var(--color-text-primary)',
                        whiteSpace: 'pre',
                        overflowX: 'auto',
                      }}>
                        {fileContent.content}
                      </pre>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );

  // ── Tree panel content ────────────────────────────────────────────────────────
  // The toolbar: New File button, filter input, show/hide toggles, refresh, terminal

  const treeToolbar = (
    <div style={{
      padding: '6px 8px',
      borderBottom: '1px solid var(--color-border-base)',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    }}>
      {/* Row 1: New File + filter input + icon buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {/* New File button — disabled when filter is active */}
        <Tooltip content={filterQuery ? 'Clear filter to create files' : 'New file'} position="bottom">
          <button
            onClick={() => {
              if (!selectedSession?.folderPath || filterQuery) return;
              setInlineCreate({ parentPath: selectedSession.folderPath, isDir: false });
            }}
            disabled={!selectedSession?.folderPath || filterQuery.length > 0}
            style={{
              background: 'none',
              border: 'none',
              cursor: (!selectedSession?.folderPath || filterQuery.length > 0) ? 'not-allowed' : 'pointer',
              padding: '2px',
              display: 'inline-flex',
              borderRadius: 'var(--radius-sm)',
              color: filterQuery ? 'var(--color-text-disabled, var(--color-text-muted))' : 'var(--color-text-muted)',
              opacity: filterQuery ? 0.4 : 1,
              transition: 'color var(--transition-fast)',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { if (!filterQuery && selectedSession?.folderPath) e.currentTarget.style.color = 'var(--color-text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = filterQuery ? 'var(--color-text-disabled, var(--color-text-muted))' : 'var(--color-text-muted)'; }}
          >
            <FilePlus size={14} strokeWidth={1.75} />
          </button>
        </Tooltip>

        {/* Filter input */}
        <input
          type="text"
          placeholder="Filter files…"
          value={filterQuery}
          onChange={e => setFilterQuery(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            boxSizing: 'border-box',
            fontSize: '12px',
            padding: '3px 8px',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: '4px',
            background: 'var(--color-bg-input)',
            color: 'var(--color-text-primary)',
            outline: 'none',
            fontFamily: 'var(--font-sans)',
          }}
        />

        {/* Show/hide untracked toggle */}
        <Tooltip content={showUntracked ? 'Hide untracked files' : 'Show untracked files'} position="bottom">
          <button
            onClick={() => setShowUntracked(v => !v)}
            style={{
              background: showUntracked ? 'none' : 'var(--color-accent-subtle)',
              border: 'none',
              cursor: 'pointer',
              padding: '2px',
              display: 'inline-flex',
              borderRadius: 'var(--radius-sm)',
              color: showUntracked ? 'var(--color-text-muted)' : 'var(--color-accent)',
              transition: 'color var(--transition-fast)',
              flexShrink: 0,
            }}
            title={showUntracked ? 'Showing untracked' : 'Hiding untracked'}
          >
            {showUntracked ? <Eye size={13} strokeWidth={1.75} /> : <EyeOff size={13} strokeWidth={1.75} />}
          </button>
        </Tooltip>

        {/* Show/hide ignored toggle */}
        <Tooltip content={showIgnored ? 'Hide ignored files' : 'Show ignored files'} position="bottom">
          <button
            onClick={() => setShowIgnored(v => !v)}
            style={{
              background: showIgnored ? 'var(--color-accent-subtle)' : 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px',
              display: 'inline-flex',
              borderRadius: 'var(--radius-sm)',
              color: showIgnored ? 'var(--color-accent)' : 'var(--color-text-muted)',
              transition: 'color var(--transition-fast)',
              flexShrink: 0,
              fontSize: '10px',
              fontWeight: 600,
              width: '16px',
              height: '16px',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={showIgnored ? 'Hiding ignored' : 'Showing ignored'}
          >
            .i
          </button>
        </Tooltip>

        {/* Refresh */}
        <button
          onClick={() => setTreeKey(k => k + 1)}
          title="Refresh tree"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px',
            display: 'inline-flex',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-muted)',
            transition: 'color var(--transition-fast)',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
        >
          <RefreshCw size={13} strokeWidth={1.75} />
        </button>

        {/* Terminal toggle */}
        {selectedSession && socket && (
          <button
            onClick={toggleTerminal}
            title={showTerminal ? 'Close terminal' : 'Open terminal'}
            style={{
              background: showTerminal ? 'var(--color-accent)' : 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px',
              display: 'inline-flex',
              borderRadius: 'var(--radius-sm)',
              color: showTerminal ? '#fff' : 'var(--color-text-muted)',
              transition: 'color var(--transition-fast)',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { if (!showTerminal) e.currentTarget.style.color = 'var(--color-text-primary)'; }}
            onMouseLeave={(e) => { if (!showTerminal) e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            <TerminalIcon size={13} strokeWidth={1.75} />
          </button>
        )}
      </div>

      {/* Row 2: folder path display */}
      <div style={{
        fontSize: '10px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--color-text-muted)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {selectedSession?.folderPath || '—'}
      </div>
    </div>
  );

  const treeBody = (
    <div style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {!selectedSession?.folderPath ? (
        <div style={{
          padding: '16px 12px',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-muted)',
          fontStyle: 'italic',
        }}>
          Session has no working directory set
        </div>
      ) : (
        <>
          {/* Inline create row at root level */}
          {inlineCreate && inlineCreate.parentPath === selectedSession.folderPath && (
            <InlineCreateRow
              isDir={inlineCreate.isDir}
              siblingNames={[]}
              onConfirm={handleInlineCreateConfirm}
              onCancel={() => setInlineCreate(null)}
            />
          )}
          <VirtualFileTree
            key={`${selectedSessionId}-${treeKey}`}
            rootPath={selectedSession.folderPath}
            gitStatusMap={absoluteGitStatusMap}
            filterQuery={filterQuery}
            showUntracked={showUntracked}
            showIgnored={showIgnored}
            selectedFilePath={selectedFilePath}
            onFileSelect={handleFileSelect}
            renderRow={renderRow}
          />
        </>
      )}

      {/* Context menu */}
      {contextMenu && selectedSessionId && (
        <ExplorerContextMenu
          entry={contextMenu.entry}
          gitStatus={contextEntryGitStatus}
          position={contextMenu.position}
          sessionId={selectedSessionId}
          onAction={async (action) => {
            await handleContextAction(action);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );

  // ── Narrow layout helpers ─────────────────────────────────────────────────────
  const narrowSessionSelect = !embedded && (
    <select
      value={selectedSessionId ?? ''}
      onChange={e => handleSessionSelect(e.target.value)}
      style={{
        flex: 1,
        minWidth: 0,
        fontSize: '11px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--color-text-secondary)',
        background: 'var(--color-bg-input)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: '4px',
        padding: '1px 4px',
        cursor: 'pointer',
        outline: 'none',
      }}
    >
      {sessions.map(s => (
        <option key={s.id} value={s.id}>
          {s.hasGitChanges ? '⚠ ' : ''}{s.name} — {s.folderPath.split('/').slice(-2).join('/')}
        </option>
      ))}
    </select>
  );

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      style={{
        height: embedded ? '100%' : `calc(100vh - var(--header-height) - var(--nav-tabs-height) - var(--shared-terminal-height, 0px))`,
        display: 'flex',
        flexDirection: isNarrow ? 'column' : 'row',
        overflow: 'hidden',
      }}
    >
      {isNarrow ? (
        /* ── Narrow layout ── */
        <>
          {/* Header row 1: session select + controls */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 10px',
            borderBottom: '1px solid var(--color-border-base)',
            background: 'var(--color-bg-header)',
            flexShrink: 0,
            minHeight: '36px',
          }}>
            {narrowSessionSelect}
            <button
              onClick={() => setTreeKey(k => k + 1)}
              title="Refresh tree"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 0, width: '28px', height: '28px',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', flexShrink: 0,
              }}
            >
              <RefreshCw size={14} strokeWidth={1.75} />
            </button>
            <button
              onClick={() => setIsTreeVisible(v => !v)}
              title={isTreeVisible ? 'Collapse file tree' : 'Expand file tree'}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 0, width: '28px', height: '28px',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', flexShrink: 0,
              }}
            >
              {isTreeVisible
                ? <PanelLeftClose size={15} strokeWidth={1.75} />
                : <PanelLeft size={15} strokeWidth={1.75} />}
            </button>
          </div>

          {/* Header row 2: filter input */}
          <div style={{
            padding: '5px 10px',
            borderBottom: '1px solid var(--color-border-base)',
            background: 'var(--color-bg-header)',
            flexShrink: 0,
          }}>
            <input
              type="text"
              placeholder="Filter files…"
              value={filterQuery}
              onChange={e => setFilterQuery(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                fontSize: '12px',
                padding: '3px 8px',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: '4px',
                background: 'var(--color-bg-input)',
                color: 'var(--color-text-primary)',
                outline: 'none',
                fontFamily: 'var(--font-sans)',
              }}
            />
          </div>

          {/* Collapsible file tree */}
          {isTreeVisible && (
            <div style={{
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--color-bg-base)',
              borderBottom: '1px solid var(--color-border-base)',
              maxHeight: '45vh',
              overflow: 'hidden',
            }}>
              <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
                {!selectedSession?.folderPath ? (
                  <div style={{
                    padding: '16px 12px', fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-muted)', fontStyle: 'italic',
                  }}>
                    Session has no working directory set
                  </div>
                ) : (
                  <>
                    {inlineCreate && inlineCreate.parentPath === selectedSession.folderPath && (
                      <InlineCreateRow
                        isDir={inlineCreate.isDir}
                        siblingNames={[]}
                        onConfirm={handleInlineCreateConfirm}
                        onCancel={() => setInlineCreate(null)}
                      />
                    )}
                    <VirtualFileTree
                      key={`${selectedSessionId}-${treeKey}`}
                      rootPath={selectedSession.folderPath}
                      gitStatusMap={absoluteGitStatusMap}
                      filterQuery={filterQuery}
                      showUntracked={showUntracked}
                      showIgnored={showIgnored}
                      selectedFilePath={selectedFilePath}
                      onFileSelect={handleFileSelect}
                      renderRow={renderRow}
                    />
                  </>
                )}
                {contextMenu && selectedSessionId && (
                  <ExplorerContextMenu
                    entry={contextMenu.entry}
                    gitStatus={contextEntryGitStatus}
                    position={contextMenu.position}
                    sessionId={selectedSessionId}
                    onAction={async (action) => { await handleContextAction(action); }}
                    onClose={() => setContextMenu(null)}
                  />
                )}
              </div>
            </div>
          )}

          {/* File preview */}
          {filePreviewPanel}
        </>
      ) : (
        /* ── Wide layout ── */
        <>
          {/* Left: Session sidebar (hidden when embedded) */}
          {!embedded && (
            <>
              <SessionSidebar
                sessions={sessions}
                activeSessionId={selectedSessionId}
                onSelectSession={handleSessionSelect}
                width={sidebarWidth}
              />
              <ResizeDivider isDragging={isSidebarDragging} onMouseDown={handleSidebarMouseDown} />
            </>
          )}

          {/* Middle: File tree with toolbar */}
          <div ref={treePanelRef} style={{
            width: `${treeWidth}px`,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--color-bg-base)',
            overflow: 'hidden',
          }}>
            {treeToolbar}
            {treeBody}
          </div>

          <ResizeDivider isDragging={isTreeDragging} onMouseDown={handleTreeMouseDown} />

          {/* Right: File preview (or ephemeral terminal when NOT using shared terminal) */}
          {showTerminal && !showTerminalProp && selectedSession ? (
            <EphemeralTerminal
              cwd={selectedSession.folderPath}
              socket={socket}
              theme={theme}
              onClose={toggleTerminal}
            />
          ) : (
            filePreviewPanel
          )}
        </>
      )}

      {/* ── Unsaved changes modal (UNCHANGED from original) ── */}
      {isElectron ? (
        <MacAlertSheet
          isOpen={showUnsavedModal}
          title="Unsaved changes"
          message="You have unsaved changes. Discard them?"
          confirmLabel="Discard"
          confirmDestructive
          onConfirm={() => {
            setShowUnsavedModal(false);
            pendingNavRef.current?.();
            pendingNavRef.current = null;
          }}
          onCancel={() => setShowUnsavedModal(false)}
        />
      ) : showUnsavedModal && (
        <div
          onClick={() => setShowUnsavedModal(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(12,13,24,0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 10000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--color-bg-header)',
              border: '1px solid var(--color-border-base)',
              borderRadius: 'var(--radius-xl)',
              padding: '24px',
              maxWidth: '360px',
              width: '90vw',
              boxShadow: 'var(--shadow-float)',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 'var(--text-md)', marginBottom: '8px', color: 'var(--color-text-primary)' }}>
              Unsaved changes
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
              You have unsaved changes. Discard them?
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowUnsavedModal(false)}
                style={{
                  padding: '6px 14px', borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border-base)',
                  background: 'none', cursor: 'pointer',
                  fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)',
                }}
              >
                Keep editing
              </button>
              <button
                onClick={() => {
                  setShowUnsavedModal(false);
                  pendingNavRef.current?.();
                  pendingNavRef.current = null;
                }}
                style={{
                  padding: '6px 14px', borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: 'var(--color-status-error, #f7768e)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)', fontWeight: 600,
                  color: '#fff',
                }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Conflict modal (UNCHANGED from original) ── */}
      {isElectron ? (
        <MacAlertSheet
          isOpen={showConflictModal}
          title="File modified externally"
          message="This file was changed since you started editing. What would you like to do?"
          confirmLabel="Overwrite"
          confirmDestructive
          altAction={{
            label: 'Reload file',
            onClick: () => { if (selectedFilePath) doFileSelect(selectedFilePath, selectedExt); },
          }}
          onConfirm={() => { setShowConflictModal(false); handleSave(true); }}
          onCancel={() => setShowConflictModal(false)}
        />
      ) : showConflictModal && (
        <div
          onClick={() => setShowConflictModal(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(12,13,24,0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 10000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--color-bg-header)',
              border: '1px solid var(--color-border-base)',
              borderRadius: 'var(--radius-xl)',
              padding: '24px',
              maxWidth: '400px',
              width: '90vw',
              boxShadow: 'var(--shadow-float)',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 'var(--text-md)', marginBottom: '8px', color: 'var(--color-text-primary)' }}>
              File modified externally
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
              This file was changed since you started editing. What would you like to do?
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                onClick={() => setShowConflictModal(false)}
                style={{
                  padding: '6px 14px', borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border-base)',
                  background: 'none', cursor: 'pointer',
                  fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowConflictModal(false);
                  if (selectedFilePath) doFileSelect(selectedFilePath, selectedExt);
                }}
                style={{
                  padding: '6px 14px', borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border-base)',
                  background: 'none', cursor: 'pointer',
                  fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)',
                }}
              >
                Reload file
              </button>
              <button
                onClick={() => {
                  setShowConflictModal(false);
                  handleSave(true);
                }}
                style={{
                  padding: '6px 14px', borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: 'var(--color-status-error, #f7768e)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)', fontWeight: 600,
                  color: '#fff',
                }}
              >
                Overwrite
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation dialog ── */}
      {confirmDelete && (
        <ConfirmActionDialog
          title={`Delete ${confirmDelete.entry.isFile ? 'file' : 'folder'}`}
          description={`Are you sure you want to delete "${confirmDelete.entry.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          isDestructive
          onConfirm={handleDeleteConfirm}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* ── Revert confirmation dialog ── */}
      {confirmRevert && (
        <ConfirmActionDialog
          title="Revert to HEAD"
          description={`Discard all local changes to "${confirmRevert.entry.name}" and restore the last committed version?`}
          confirmLabel="Revert"
          isDestructive
          onConfirm={handleRevertConfirm}
          onCancel={() => setConfirmRevert(null)}
        />
      )}

      {/* ── Toast ── */}
      {toastVisible && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: toastType === 'error' ? 'rgba(247,118,142,0.15)' : 'var(--color-bg-success, #d4f5e2)',
          border: `1px solid ${toastType === 'error' ? 'var(--color-status-error, #f7768e)' : 'var(--color-border-success, #48c774)'}`,
          borderRadius: 'var(--radius-md)',
          padding: '7px 14px',
          fontSize: 'var(--text-sm)',
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-text-primary)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          pointerEvents: 'none',
          zIndex: 9999,
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          {toastType === 'error'
            ? <XIcon size={13} strokeWidth={2.5} style={{ color: 'var(--color-status-error, #f7768e)', flexShrink: 0 }} />
            : <Check size={13} strokeWidth={2.5} style={{ color: 'var(--color-text-success, #1a7a40)', flexShrink: 0 }} />
          }
          <span style={{ color: toastType === 'error' ? 'var(--color-status-error, #f7768e)' : 'var(--color-text-success, #1a7a40)' }}>
            {toastMessage}
          </span>
        </div>
      )}
    </div>
  );
}
