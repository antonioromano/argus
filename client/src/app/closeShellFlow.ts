import type { CreateSessionRequest, SessionInfo } from '@argus/shared';

/**
 * How closing a session behaves (docs/design/feedback-surfaces.md, "Closing a
 * session"):
 * - `defer`: nothing is running (exited). Hide now, delete when the 6 s Undo
 *   toast closes; Undo brings it back exactly.
 * - `confirm`: a live agent and `confirmCloseShell` on. Ask first (AlertSheet).
 * - `immediate`: a live agent and the confirm off. Kill now, no delayed kill.
 * A live close (confirmed or immediate) can offer Reopen — see `canReopen`.
 */
export type CloseShellMode = 'defer' | 'confirm' | 'immediate';

export function closeShellMode(session: Pick<SessionInfo, 'status'>, confirmCloseShell: boolean): CloseShellMode {
  if (session.status === 'exited') return 'defer';
  return confirmCloseShell ? 'confirm' : 'immediate';
}

/** A killed live session can come back only as its Claude conversation, and
 *  v1 leaves worktree sessions out. */
export function canReopen(session: Pick<SessionInfo, 'agentType' | 'claudeSessionId' | 'worktreePath'>): boolean {
  return session.agentType === 'claude' && !!session.claudeSessionId && !session.worktreePath;
}

/** The create request that reopens `session`'s conversation. Same folder, name,
 *  flags, engine and run mode; the server never persists the resume argv. */
export function reopenRequest(session: SessionInfo): CreateSessionRequest {
  return {
    folderPath: session.folderPath,
    name: session.name,
    agentType: session.agentType,
    flags: session.flags,
    terminalEngine: session.terminalEngine,
    runMode: session.runMode,
    resumeClaudeSessionId: session.claudeSessionId,
  };
}

/** Where the session sat in its group, so Reopen puts it back there. */
export interface GroupSlot {
  groupId: string;
  /** The member it sat directly above, or null when it was last. */
  beforeId: string | null;
}

export function groupSlotOf(
  groups: ReadonlyArray<{ id: string; sessionIds: readonly string[] }>,
  sessionId: string,
  skipGroupIds: ReadonlySet<string> = new Set(),
): GroupSlot | null {
  for (const g of groups) {
    if (skipGroupIds.has(g.id)) continue;
    const i = g.sessionIds.indexOf(sessionId);
    if (i !== -1) return { groupId: g.id, beforeId: g.sessionIds[i + 1] ?? null };
  }
  return null;
}
