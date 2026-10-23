import type { AgentType, ChatMessage, ChatUpdate } from '@argus/shared';

/** Client-side cap, matching the server's per-transcript window. */
export const MAX_CLIENT_CHAT_MESSAGES = 2000;

export interface ChatState {
  /** False until the first `session:chat` for this session arrived. */
  loaded: boolean;
  /** False while the session has no readable transcript (fall back to the terminal). */
  available: boolean;
  messages: ChatMessage[];
}

export const EMPTY_CHAT: ChatState = { loaded: false, available: false, messages: [] };

/**
 * Fold one server update into the chat state. A reset replaces the list; an
 * append adds messages not seen yet (a snapshot and an append can overlap
 * when a second viewer subscribes mid-read, so ids are deduped).
 */
export function applyChatUpdate(prev: ChatState, update: Pick<ChatUpdate, 'reset' | 'available' | 'messages'>): ChatState {
  if (update.reset) {
    return { loaded: true, available: update.available, messages: update.messages.slice(-MAX_CLIENT_CHAT_MESSAGES) };
  }
  if (update.messages.length === 0) return { ...prev, loaded: true, available: update.available };
  const seen = new Set(prev.messages.map((m) => m.id));
  const fresh = update.messages.filter((m) => !seen.has(m.id));
  if (fresh.length === 0 && prev.loaded && prev.available === update.available) return prev;
  const messages = prev.messages.concat(fresh);
  return { loaded: true, available: update.available, messages: messages.slice(-MAX_CLIENT_CHAT_MESSAGES) };
}

/** Agents whose sessions offer the Chat view (Gemini and Codex stay terminal-only). */
export function supportsChatView(agentType: AgentType): boolean {
  return agentType === 'claude';
}

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/**
 * The pty bytes that type `text` into the agent's prompt, without the Enter.
 * Multi-line text goes in as a bracketed paste so its newlines stay newlines
 * instead of submitting the first line; CRLF/CR are normalized to LF.
 */
export function chatInputBytes(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  return normalized.includes('\n') ? PASTE_START + normalized + PASTE_END : normalized;
}

/**
 * Gap between the text and its Enter. Claude's Ink input reads text and CR
 * arriving in one chunk as a paste and inserts a newline instead of
 * submitting (same reason as the server's BROADCAST_ENTER_DELAY_MS).
 */
export const CHAT_ENTER_DELAY_MS = 60;
