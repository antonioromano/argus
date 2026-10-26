import type { AgentType, ChatCommand, ChatMessage, ChatUpdate } from '@argus/shared';

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
  /** Skills and custom commands from the transcript (the composer adds the built-ins). */
  commands?: ChatCommand[];
}

export const EMPTY_CHAT: ChatState = { loaded: false, available: false, messages: [] };

/**
 * Fold one server update into the chat state. A reset replaces the list; an
 * append adds messages not seen yet (a snapshot and an append can overlap
 * when a second viewer subscribes mid-read, so ids are deduped).
 */
export function applyChatUpdate(
  prev: ChatState,
  update: Pick<ChatUpdate, 'reset' | 'available' | 'messages' | 'permissionMode' | 'modelSet' | 'removed' | 'commands'>,
): ChatState {
  if (update.reset) {
    return {
      loaded: true,
      available: update.available,
      messages: update.messages.slice(-MAX_CLIENT_CHAT_MESSAGES),
      permissionMode: update.permissionMode,
      modelSet: update.modelSet,
      commands: update.commands,
    };
  }
  // Appends carry the mode and model only when they changed.
  const permissionMode = update.permissionMode ?? prev.permissionMode;
  const modelSet = update.modelSet ?? prev.modelSet;
  const commands = update.commands ?? prev.commands;
  // Echoes the transcript caught up with (see ChatMessage.echo).
  const removed = update.removed?.length ? new Set(update.removed) : undefined;
  const filtered = removed ? prev.messages.filter((m) => !removed.has(m.id)) : prev.messages;
  const kept = filtered.length === prev.messages.length ? prev.messages : filtered;
  const seen = new Set(kept.map((m) => m.id));
  const fresh = update.messages.filter((m) => !seen.has(m.id));
  if (
    fresh.length === 0 &&
    kept === prev.messages &&
    prev.loaded &&
    prev.available === update.available &&
    prev.permissionMode === permissionMode &&
    prev.modelSet === modelSet &&
    prev.commands === commands
  ) {
    return prev;
  }
  const messages = fresh.length ? kept.concat(fresh).slice(-MAX_CLIENT_CHAT_MESSAGES) : kept;
  return { loaded: true, available: update.available, messages, permissionMode, modelSet, commands };
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


/**
 * Claude Code's built-in slash commands, for the composer's `/` autocomplete.
 * Skills and custom commands come from the transcript (ChatState.commands).
 */
export const BUILTIN_COMMANDS: readonly ChatCommand[] = [
  { name: 'add-dir', description: 'Add a working directory' },
  { name: 'agents', description: 'Manage subagents' },
  { name: 'clear', description: 'Start a new conversation' },
  { name: 'compact', description: 'Summarize the conversation to free context' },
  { name: 'config', description: 'Open settings' },
  { name: 'context', description: 'Show what fills the context window' },
  { name: 'cost', description: 'Show usage and limits' },
  { name: 'doctor', description: 'Check the Claude Code install' },
  { name: 'effort', description: 'Set the reasoning effort' },
  { name: 'export', description: 'Export the conversation' },
  { name: 'help', description: 'Show help and commands' },
  { name: 'hooks', description: 'Manage hooks' },
  { name: 'init', description: 'Create a CLAUDE.md for this project' },
  { name: 'mcp', description: 'Manage MCP servers' },
  { name: 'memory', description: 'Edit memory files' },
  { name: 'model', description: 'Switch the model' },
  { name: 'permissions', description: 'Manage tool permissions' },
  { name: 'plugin', description: 'Manage plugins' },
  { name: 'resume', description: 'Resume an earlier conversation' },
  { name: 'review', description: 'Review a pull request' },
  { name: 'rewind', description: 'Go back to an earlier point' },
  { name: 'status', description: 'Show version, model and account' },
  { name: 'usage', description: 'Show plan usage' },
];

/** Suggestions shown at most. */
export const MAX_SLASH_SUGGESTIONS = 50;

/**
 * Commands for a `/query` typed at the start of the composer: names starting
 * with it first (also the part after a `plugin:` prefix), then names that
 * contain it; built-ins before skills of the same rank, duplicates dropped.
 */
export function slashSuggestions(query: string, custom: readonly ChatCommand[] = []): ChatCommand[] {
  const q = query.toLowerCase();
  const seen = new Set<string>();
  const all: ChatCommand[] = [];
  for (const c of [...BUILTIN_COMMANDS, ...custom]) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    all.push(c);
  }
  const rank = (c: ChatCommand): number => {
    const n = c.name.toLowerCase();
    if (n.startsWith(q)) return 0;
    if (n.slice(n.lastIndexOf(':') + 1).startsWith(q)) return 1;
    return n.includes(q) ? 2 : -1;
  };
  return all
    .map((c, i) => ({ c, r: rank(c), i }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, MAX_SLASH_SUGGESTIONS)
    .map((x) => x.c);
}

/** The `/query` being typed (a single token at the very start, caret at its end), else null. */
export function slashQuery(value: string, caret: number): string | null {
  const m = /^\/([\w:.-]*)$/.exec(value);
  return m && caret === value.length ? m[1] : null;
}
