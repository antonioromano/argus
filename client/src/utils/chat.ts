import type { AgentType, ChatMessage, ChatUpdate } from '@argus/shared';

/** Client-side cap, matching the server's per-transcript window. */
export const MAX_CLIENT_CHAT_MESSAGES = 2000;

export interface ChatState {
  /** False until the first `session:chat` for this session arrived. */
  loaded: boolean;
  /** False while the session has no readable transcript (fall back to the terminal). */
  available: boolean;
  messages: ChatMessage[];
  /** Claude Code's permission mode, when the transcript recorded one. */
  permissionMode?: string;
  /** Display name of the model last set with `/model`, when there was one. */
  modelSet?: string;
}

export const EMPTY_CHAT: ChatState = { loaded: false, available: false, messages: [] };

/**
 * Fold one server update into the chat state. A reset replaces the list; an
 * append adds messages not seen yet (a snapshot and an append can overlap
 * when a second viewer subscribes mid-read, so ids are deduped).
 */
export function applyChatUpdate(
  prev: ChatState,
  update: Pick<ChatUpdate, 'reset' | 'available' | 'messages' | 'permissionMode' | 'modelSet'>,
): ChatState {
  if (update.reset) {
    return {
      loaded: true,
      available: update.available,
      messages: update.messages.slice(-MAX_CLIENT_CHAT_MESSAGES),
      permissionMode: update.permissionMode,
      modelSet: update.modelSet,
    };
  }
  // Appends carry the mode and model only when they changed.
  const permissionMode = update.permissionMode ?? prev.permissionMode;
  const modelSet = update.modelSet ?? prev.modelSet;
  const seen = new Set(prev.messages.map((m) => m.id));
  const fresh = update.messages.filter((m) => !seen.has(m.id));
  if (
    fresh.length === 0 &&
    prev.loaded &&
    prev.available === update.available &&
    prev.permissionMode === permissionMode &&
    prev.modelSet === modelSet
  ) {
    return prev;
  }
  const messages = fresh.length ? prev.messages.concat(fresh).slice(-MAX_CLIENT_CHAT_MESSAGES) : prev.messages;
  return { loaded: true, available: update.available, messages, permissionMode, modelSet };
}

const MODE_LABELS: Record<string, string> = {
  // Claude Code's footer calls the default mode "manual".
  default: 'Manual',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  auto: 'Auto',
  bypassPermissions: 'Bypass permissions',
  dontAsk: "Don't ask",
};

/** Display name of a Claude Code permission mode; unknown modes show as written. */
export function permissionModeLabel(mode: string): string {
  return MODE_LABELS[mode] ?? mode;
}

/** "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5". */
export function modelLabel(model: string): string {
  const parts = model.replace(/^claude-/, '').replace(/-\d{8}$/, '').split('-');
  const i = parts.findIndex((p) => /^\d+$/.test(p));
  if (i <= 0) return model;
  const name = parts.slice(0, i).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  return `${name} ${parts.slice(i).join('.')}`;
}

/** Modes offered in the Chat view's picker, in Claude Code's Shift+Tab order. */
export const PICKABLE_MODES = ['default', 'acceptEdits', 'plan', 'auto'] as const;

/** Models offered in the Chat view's picker (`/model <id>`); the rest via the terminal picker. */
export const PICKABLE_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
];

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic)$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path);
}

/** Agents whose sessions offer the Chat view (Gemini and Codex stay terminal-only). */
export function supportsChatView(agentType: AgentType): boolean {
  return agentType === 'claude';
}

