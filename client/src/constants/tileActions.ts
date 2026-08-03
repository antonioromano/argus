import type { TileQuickAction } from '@argus/shared';
import type { ShortcutActionId } from '../keyboard/registry.js';
import {
  GitBranch,
  FolderOpen,
  Terminal,
  Copy,
  RotateCcw,
  CheckCircle2,
  ArrowDownToLine,
  Minus,
  type LucideIcon,
} from 'lucide-react';

/**
 * Single source of truth for the mosaic tile header's configurable action.
 *
 * Minimize and Expand are deliberately absent: they are permanent window
 * controls in every tile header, so offering them as a pin would only let a
 * user duplicate a button they already have.
 */
export interface TileActionMeta {
  id: TileQuickAction;
  label: string;
  /** One line shown in the first-run picker and the settings dropdown. */
  hint: string;
  icon: LucideIcon;
  /** Bound action this pin duplicates, so the label can be rendered from the
   *  live binding rather than a glyph that goes stale on a rebind. */
  shortcutId?: ShortcutActionId;
}

export const TILE_ACTION_META: Record<Exclude<TileQuickAction, 'none'>, TileActionMeta> = {
  diff:    { id: 'diff',    label: 'Diff',      hint: 'Open the diff workbench for this shell', icon: GitBranch,       shortcutId: 'open-diff' },
  files:   { id: 'files',   label: 'Files',     hint: 'Open the file explorer at this folder',  icon: FolderOpen,      shortcutId: 'open-files' },
  shell:   { id: 'shell',   label: 'Shell',     hint: 'Open a plain terminal in this folder',   icon: Terminal,        shortcutId: 'open-shell' },
  clone:   { id: 'clone',   label: 'Clone',     hint: 'Start a new shell in the same folder',   icon: Copy },
  restart: { id: 'restart', label: 'Restart',   hint: 'Restart the agent process',              icon: RotateCcw },
  done:    { id: 'done',    label: 'Mark done', hint: 'Flag the run as finished',               icon: CheckCircle2 },
  apply:   { id: 'apply',   label: 'Apply',     hint: 'Apply this worktree to the project',     icon: ArrowDownToLine },
};

export const NONE_ACTION_META: TileActionMeta = {
  id: 'none',
  label: 'None',
  hint: 'No pinned icon — reach everything from the ⋯ menu',
  icon: Minus,
};

export const DEFAULT_TILE_QUICK_ACTION: TileQuickAction = 'diff';

/** Order shown in settings. The first-run picker takes the leading 5 + None. */
export const PICKABLE_QUICK_ACTIONS: TileQuickAction[] = [
  'diff', 'files', 'shell', 'clone', 'restart', 'done', 'apply', 'none',
];

/** The subset offered as cards in the first-run sheet — the ones worth a pin. */
export const PROMPT_QUICK_ACTIONS: TileQuickAction[] = ['diff', 'files', 'shell', 'clone', 'restart', 'none'];

export function tileActionMeta(id: TileQuickAction): TileActionMeta {
  return id === 'none' ? NONE_ACTION_META : TILE_ACTION_META[id];
}
