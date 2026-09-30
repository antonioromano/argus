export type QuitSummary = { name: string; status: string; terminalEngine?: string; runMode?: 'persistent' | 'direct' };

export type QuitConfirmation =
  | { kind: 'none' }
  | { kind: 'stop-all'; sessions: QuitSummary[] }
  | { kind: 'direct'; sessions: QuitSummary[] };

/**
 * Which confirmation, if any, ⌘Q shows. The existing stop-all dialog (the
 * "Exit sessions on quit" setting) keeps precedence — it already covers every
 * session. Otherwise a plain quit detaches persistent sessions but kills direct
 * ones, so it asks when a direct session is still running (spec D3).
 */
export function decideQuitConfirmation(i: {
  explicitStopAll: boolean;
  exitSessionsOnQuit: boolean;
  confirmExitOnQuit: boolean;
  confirmQuitDirectSessions: boolean;
  sessions: QuitSummary[];
}): QuitConfirmation {
  const live = i.sessions.filter((s) => s.status !== 'exited');
  if (i.explicitStopAll) return { kind: 'none' };
  if (i.exitSessionsOnQuit) {
    return i.confirmExitOnQuit && live.length > 0 ? { kind: 'stop-all', sessions: live } : { kind: 'none' };
  }
  const direct = live.filter((s) => s.runMode === 'direct');
  return i.confirmQuitDirectSessions && direct.length > 0 ? { kind: 'direct', sessions: direct } : { kind: 'none' };
}
