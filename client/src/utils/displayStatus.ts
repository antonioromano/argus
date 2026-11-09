import type { SessionInfo, SessionStatus } from '@argus/shared';

/**
 * What a status surface shows. `agents` is derived, never detected: the
 * session's own turn is idle while its subagents are still working. The
 * detector's `SessionStatus` stays the truth for the Waiting inbox and
 * notifications.
 */
export type DisplayStatus = SessionStatus | 'agents';

export function displayStatus(s: Pick<SessionInfo, 'status' | 'agentsRunning'>): DisplayStatus {
  return s.status === 'idle' && (s.agentsRunning ?? 0) > 0 ? 'agents' : s.status;
}

/** Sorting and filtering treat an `agents` session as running. */
export function sortStatus(s: DisplayStatus): SessionStatus {
  return s === 'agents' ? 'running' : s;
}
