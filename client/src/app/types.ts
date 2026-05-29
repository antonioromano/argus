import type { SessionInfo } from '@argus/shared';

export type View = 'dashboard' | 'focus';

export type Overlay =
  | { kind: 'create' }
  | { kind: 'clone'; folderPath: string; agentType?: string }
  | { kind: 'palette' }
  | { kind: 'update' }
  | { kind: 'settings'; initialTab?: string }
  | { kind: 'diff'; sessionId: string; file?: string }
  | { kind: 'explorer'; sessionId: string; filePath?: string; lineNumber?: number }
  | { kind: 'sessionPicker'; target: 'diff' | 'explorer' }
  | null;

export type SidePanel =
  | { kind: 'diff'; sessionId: string }
  | { kind: 'explorer'; sessionId: string }
  | { kind: 'terminal'; sessionId: string }
  | null;

export type SidebarKey =
  | 'sessions'
  | 'palette'
  | 'settings';

export interface SessionCounts {
  total: number;
  waiting: number;
  running: number;
  idle: number;
  exited: number;
  dirty: number;
}

export function deriveCounts(sessions: SessionInfo[]): SessionCounts {
  return {
    total: sessions.length,
    waiting: sessions.filter((s) => s.status === 'waiting').length,
    running: sessions.filter((s) => s.status === 'running').length,
    idle: sessions.filter((s) => s.status === 'idle').length,
    exited: sessions.filter((s) => s.status === 'exited').length,
    dirty: sessions.filter((s) => !!s.hasGitChanges).length,
  };
}
