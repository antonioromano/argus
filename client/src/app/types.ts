import type { RunMode, SessionInfo, SessionPrEntry, TerminalEngine } from '@argus/shared';
import type { IntroFlow } from './intro/intro.js';

export type View = 'dashboard' | 'focus';

export type Overlay =
  | { kind: 'create' }
  | { kind: 'clone'; folderPath: string; agentType?: string; terminalEngine?: TerminalEngine; runMode?: RunMode }
  | { kind: 'palette' }
  | { kind: 'inbox' }
  | { kind: 'search' }
  | { kind: 'broadcast'; sessionIds: string[] }
  | { kind: 'update' }
  | { kind: 'settings'; initialTab?: string }
  | { kind: 'sessionPicker'; target: 'diff' | 'explorer' }
  | { kind: 'intro'; flow: IntroFlow }
  | null;

/**
 * Diff/Explorer side panels carry a `maximized` flag: false → docked right rail,
 * true → full-view tool window over the shell (see Focus.tsx). The terminal
 * companion panel has no full-view, so it omits the flag. Diff/explorer also carry
 * the optional entry target (file/line/query) so the maximized workbench can open
 * focused on a specific file — e.g. when launched from the command palette.
 */
export type SidePanel =
  | { kind: 'diff'; sessionId: string; maximized?: boolean; file?: string }
  | { kind: 'explorer'; sessionId: string; maximized?: boolean; filePath?: string; lineNumber?: number; query?: string }
  | { kind: 'terminal'; sessionId: string }
  /** Beta F6 activity timeline, docked like the companion shell. */
  | { kind: 'activity'; sessionId: string }
  /** One pull request's changed files and diff (B4): full-view only. */
  | { kind: 'prdiff'; sessionId: string; maximized?: boolean; pr: SessionPrEntry }
  | null;

/** Tool-window kinds that support the full-view maximize. */
export type MaximizableKind = 'diff' | 'explorer' | 'prdiff';

// A Record, so adding a MaximizableKind without listing it here fails to compile.
const MAXIMIZABLE: Record<MaximizableKind, true> = { diff: true, explorer: true, prdiff: true };

/** A tool window open in full-view over the shell (Focus renders it, Esc closes it). */
export function isMaximizedPanel(p: SidePanel): p is Extract<NonNullable<SidePanel>, { kind: MaximizableKind }> {
  return !!p && Object.hasOwn(MAXIMIZABLE, p.kind) && (p as { maximized?: boolean }).maximized === true;
}

/** Payload for opening a diff/explorer tool window directly in full-view. */
export type MaximizablePanel =
  | { kind: 'diff'; sessionId: string; file?: string }
  | { kind: 'explorer'; sessionId: string; filePath?: string; lineNumber?: number; query?: string }
  | { kind: 'prdiff'; sessionId: string; pr: SessionPrEntry };

export type SidebarKey =
  | 'sessions'
  | 'palette'
  | 'settings';

export interface SessionCounts {
  total: number;
  waiting: number;
  running: number;
  idle: number;
  done: number;
  exited: number;
  dirty: number;
}

export function deriveCounts(sessions: SessionInfo[]): SessionCounts {
  return {
    total: sessions.length,
    waiting: sessions.filter((s) => s.status === 'waiting').length,
    running: sessions.filter((s) => s.status === 'running').length,
    idle: sessions.filter((s) => s.status === 'idle').length,
    done: sessions.filter((s) => s.status === 'done').length,
    exited: sessions.filter((s) => s.status === 'exited').length,
    dirty: sessions.filter((s) => !!s.hasGitChanges).length,
  };
}
