import type { SessionInfo } from '@argus/shared';

/**
 * True when "Resume conversation" applies: an exited Claude session whose hooks
 * reported a conversation id. The server re-validates the id before it reaches
 * argv; this only decides whether to offer the action.
 */
export function canResume(s: SessionInfo): boolean {
  return s.agentType === 'claude' && s.status === 'exited' && !!s.claudeSessionId;
}
