import { CircleX, Minus, Maximize2, ArrowDownToLine, Copy, GitBranch, FolderOpen, Terminal, RotateCcw, CheckCircle2, Bug, Pencil } from 'lucide-react';
import type { SessionInfo } from '@argus/shared';
import type { ContextMenuEntry } from '../../components/primitives/index.js';
import type { ShortcutActionId } from '../../keyboard/registry.js';
import type { ResolvedShortcuts } from '../../keyboard/useShortcuts.js';
import { formatCombo } from '../../keyboard/combo.js';

/**
 * Every action a live shell can be told to do. One list, four surfaces: the
 * mosaic tile's ⋯ button and the right-click menu on the tile header, the focus
 * header, the sidebar rows, and the minimized chips. Optional handlers collapse
 * their entry, so a surface that cannot minimize (a sidebar row) simply omits
 * `onToggleMinimize` rather than showing a dead item.
 */
export interface SessionMenuActions {
  onRename: (session: SessionInfo) => void;
  onOpen: (id: string) => void;
  onKill: (session: SessionInfo) => void;
  onRestart: (session: SessionInfo) => void;
  onToggleMinimize?: (id: string) => void;
  onDumpDiagnostics?: (session: SessionInfo) => void;
  showDiagnostics?: boolean;
  onMarkDone?: (session: SessionInfo) => void;
  /** Per-session gate: an entry only appears for a session it actually applies to. */
  canMarkDone?: (session: SessionInfo) => boolean;
  onMerge?: (session: SessionInfo) => void;
  canMerge?: (session: SessionInfo) => boolean;
  onClone?: (session: SessionInfo) => void;
  onFocusDiff?: (id: string) => void;
  onFocusExplorer?: (id: string) => void;
  onFocusTerminal?: (id: string) => void;
  onOpenDiff?: (id: string) => void;
}

/**
 * Build the shell action menu. Shortcut labels come from the live bindings, so a
 * rebind in settings cannot leave the menu advertising a key that no longer does
 * anything.
 */
export function buildSessionMenuItems(
  session: SessionInfo,
  a: SessionMenuActions,
  shortcuts?: ResolvedShortcuts,
): ContextMenuEntry[] {
  const comboLabel = (id: ShortcutActionId): string | undefined =>
    shortcuts ? formatCombo(shortcuts[id]) : undefined;

  return [
    { header: 'Navigate' },
    {
      id: 'diff',
      label: session.hasGitChanges ? 'Diff — has changes' : 'Diff',
      icon: GitBranch,
      shortcut: comboLabel('open-diff'),
      disabled: !a.onFocusDiff && !a.onOpenDiff,
      onClick: () => { if (a.onFocusDiff) a.onFocusDiff(session.id); else a.onOpenDiff?.(session.id); },
    },
    ...(a.onFocusExplorer ? [{ id: 'files', label: 'Files', icon: FolderOpen, shortcut: comboLabel('open-files'), onClick: () => a.onFocusExplorer!(session.id) }] : []),
    ...(a.onFocusTerminal ? [{ id: 'shell', label: 'Shell', icon: Terminal, shortcut: comboLabel('open-shell'), onClick: () => a.onFocusTerminal!(session.id) }] : []),
    { id: 'focus', label: 'Expand to focus', icon: Maximize2, onClick: () => a.onOpen(session.id) },
    { separator: true },
    { header: 'Session' },
    { id: 'rename', label: 'Rename shell', icon: Pencil, onClick: () => a.onRename(session) },
    ...(a.onToggleMinimize ? [{ id: 'minimize', label: 'Minimize', icon: Minus, onClick: () => a.onToggleMinimize!(session.id) }] : []),
    ...(a.onClone ? [{ id: 'clone', label: 'Clone shell', icon: Copy, onClick: () => a.onClone!(session) }] : []),
    ...(a.onMerge && a.canMerge?.(session) ? [{ id: 'apply', label: 'Apply to project', icon: ArrowDownToLine, onClick: () => a.onMerge!(session) }] : []),
    ...(a.onMarkDone && a.canMarkDone?.(session) ? [{ id: 'done', label: 'Mark as done', icon: CheckCircle2, onClick: () => a.onMarkDone!(session) }] : []),
    { id: 'restart', label: 'Restart shell', icon: RotateCcw, onClick: () => a.onRestart(session) },
    ...(a.showDiagnostics && a.onDumpDiagnostics ? [{ id: 'diag', label: 'Dump diagnostics', icon: Bug, onClick: () => a.onDumpDiagnostics!(session) }] : []),
    { separator: true },
    { header: 'Danger' },
    { id: 'close', label: 'Close shell', icon: CircleX, shortcut: comboLabel('close-shell'), danger: true, onClick: () => a.onKill(session) },
  ];
}
