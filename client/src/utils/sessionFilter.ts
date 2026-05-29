import type { SessionInfo } from '@argus/shared';

export function filterSessions(sessions: SessionInfo[], q: string): SessionInfo[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.filter((s) =>
    s.name.toLowerCase().includes(needle) ||
    s.folderPath.toLowerCase().includes(needle) ||
    s.agentType.toLowerCase().includes(needle),
  );
}
