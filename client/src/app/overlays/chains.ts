/** Beta F13 helpers for ChainSheet / ChainsSection (kept apart so component files only export components). */
import { SHELL_AGENT_ID, type SessionInfo } from '@argus/shared';

/** Sessions a chain from `source` may target: not itself, not exited, not a plain shell. */
export function chainTargets(source: SessionInfo, sessions: SessionInfo[]): SessionInfo[] {
  return sessions.filter((s) => s.id !== source.id && s.status !== 'exited' && s.agentType !== SHELL_AGENT_ID);
}
