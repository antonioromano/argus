import { BROADCAST_MAX_TEXT, type SessionInfo } from '@argus/shared';

/** Sessions a broadcast can reach: anything with a live agent. */
export function broadcastTargets(sessions: readonly SessionInfo[]): SessionInfo[] {
  return sessions.filter((s) => s.status !== 'exited');
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f]/;

/** Mirrors the server's check so the sheet can explain a refusal before sending. */
export function broadcastTextError(text: string, enter: boolean): string | null {
  if (text.length > BROADCAST_MAX_TEXT) return `Keep it under ${BROADCAST_MAX_TEXT} characters`;
  if (CONTROL_CHARS.test(text)) return 'One line only — no newlines or control characters';
  if (!text && !enter) return 'Type something to send';
  return null;
}
