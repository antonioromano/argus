import type { ChatBlock, ChatMessage } from '@argus/shared';
import { JsonlTailer, nodeTranscriptFs, type TranscriptFs } from './JsonlTailer.js';

/**
 * Chat view (B1): turns Claude Code transcript entries into chat messages.
 *
 * The transcript format is not a public API, so the parser is deliberately
 * tolerant: a malformed line, an unknown entry type or an unexpected shape is
 * skipped (or rendered as an `unknown` block), never thrown. Only main-thread
 * user and assistant entries become messages; tool results, attachments,
 * subagent (sidechain) turns and harness-injected meta prompts are dropped.
 */

/** Messages kept per transcript; older ones fall off the front. */
export const MAX_CHAT_MESSAGES = 2000;
/** Longest text block sent to clients; longer text is cut with a marker. */
export const MAX_CHAT_TEXT = 100_000;
const MAX_NAME = 80;
const TRUNCATED = '\n\n… (truncated)';

/** Harness-only wrappers stripped from user text (never typed by the user). */
const HIDDEN_TAGS = ['system-reminder', 'local-command-caveat', 'local-command-stdout', 'local-command-stderr', 'bash-stdout', 'bash-stderr'];
const HIDDEN_RE = new RegExp(`<(${HIDDEN_TAGS.join('|')})>[\\s\\S]*?</\\1>`, 'g');

function clip(text: string): string {
  return text.length > MAX_CHAT_TEXT ? text.slice(0, MAX_CHAT_TEXT) + TRUNCATED : text;
}

/**
 * The user-visible part of a user prompt: harness wrappers removed, a slash
 * command shown as typed (`/model opus`), a `!` bash command as `! cmd`.
 */
export function cleanUserText(raw: string): string {
  const command = /<command-name>([\s\S]*?)<\/command-name>/.exec(raw);
  if (command) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(raw)?.[1]?.trim();
    return [command[1].trim(), args].filter(Boolean).join(' ');
  }
  const bash = /<bash-input>([\s\S]*?)<\/bash-input>/.exec(raw);
  if (bash) return `! ${bash[1].trim()}`;
  return raw.replace(HIDDEN_RE, '').trim();
}

function parseTs(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

function blocksOf(role: 'user' | 'assistant', content: unknown): ChatBlock[] {
  if (typeof content === 'string') {
    const text = role === 'user' ? cleanUserText(content) : content;
    return text ? [{ kind: 'text', text: clip(text) }] : [];
  }
  if (!Array.isArray(content)) return [];
  const out: ChatBlock[] = [];
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    const type = typeof b.type === 'string' ? b.type : '';
    switch (type) {
      case 'text': {
        if (typeof b.text !== 'string') break;
        const text = role === 'user' ? cleanUserText(b.text) : b.text.trim();
        if (text) out.push({ kind: 'text', text: clip(text) });
        break;
      }
      case 'tool_use':
        out.push({ kind: 'tool', name: typeof b.name === 'string' ? b.name.slice(0, MAX_NAME) : 'tool' });
        break;
      case 'image':
        out.push({ kind: 'image' });
        break;
      // Not shown in phase 1: tool output is noise in a chat, thinking is often redacted.
      case 'tool_result':
      case 'thinking':
      case 'redacted_thinking':
        break;
      default:
        out.push({ kind: 'unknown', type: type.slice(0, MAX_NAME) || 'unknown' });
    }
  }
  return out;
}

const MAX_MODE = 40;
/** Claude Code's reply to `/model`: "Set model to `Opus 5.5` and saved as …". */
const MODEL_SET_RE = /<local-command-stdout>Set model to `?([^`<\n]{1,60}?)`?(?: and |<|\n|$)/;

/** What one transcript line contributes to the chat. */
export interface ChatLine {
  message?: ChatMessage;
  /** Permission mode recorded on a main-thread user entry. */
  permissionMode?: string;
  /** Model display name from a `/model` reply. */
  modelSet?: string;
}

/**
 * One transcript line → its chat message and/or permission mode, or undefined
 * when it carries neither (other entry types, malformed JSON, …).
 */
export function parseChatLine(text: string): ChatLine | undefined {
  // Cheap prefilter: most lines are attachments, snapshots and tool results.
  if (!text.includes('"user"') && !text.includes('"assistant"')) return undefined;
  let entry: any;
  try {
    entry = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!entry || typeof entry !== 'object') return undefined;
  const role = entry.type;
  if (role !== 'user' && role !== 'assistant') return undefined;
  if (entry.isSidechain) return undefined;
  const permissionMode =
    role === 'user' && typeof entry.permissionMode === 'string' && entry.permissionMode
      ? entry.permissionMode.slice(0, MAX_MODE)
      : undefined;
  const content = entry.message?.content;
  const modelSet = role === 'user' && typeof content === 'string' ? MODEL_SET_RE.exec(content)?.[1]?.trim() : undefined;
  const message = toMessage(entry, role);
  if (!message && !permissionMode && !modelSet) return undefined;
  const out: ChatLine = { message, permissionMode };
  if (modelSet) out.modelSet = modelSet;
  return out;
}

/** One transcript line → a chat message, or undefined when it is not one. */
export function parseChatEntry(text: string): ChatMessage | undefined {
  return parseChatLine(text)?.message;
}

function toMessage(entry: any, role: 'user' | 'assistant'): ChatMessage | undefined {
  if (entry.isSidechain || entry.isMeta || entry.isCompactSummary || entry.isVisibleInTranscriptOnly) return undefined;
  if (typeof entry.uuid !== 'string' || !entry.uuid) return undefined;
  const msg = entry.message;
  if (!msg || typeof msg !== 'object') return undefined;
  const blocks = blocksOf(role, msg.content);
  if (blocks.length === 0) return undefined;
  const out: ChatMessage = { id: entry.uuid.slice(0, 64), role, blocks };
  const ts = parseTs(entry.timestamp);
  if (ts !== undefined) out.ts = ts;
  return out;
}

/** What changed since the last drain(). */
export interface ChatDelta {
  /** The file was rewritten (or this is the first read): `messages` is everything. */
  reset: boolean;
  messages: ChatMessage[];
  /** Set on a reset, and when the permission mode changed since the last drain. */
  permissionMode?: string;
  /** Same, for the model set with `/model`. */
  modelSet?: string;
}

/**
 * Incremental chat reader of one transcript. Shares the byte-level tailing
 * with the usage tailer (JsonlTailer) but reads from byte 0, since the chat
 * needs the history the usage tailer has already counted and moved past.
 */
export class ChatTail extends JsonlTailer {
  /** The newest MAX_CHAT_MESSAGES messages. */
  messages: ChatMessage[] = [];
  /** Latest permission mode seen on a user entry. */
  permissionMode?: string;
  /** Latest model set with `/model`. */
  modelSet?: string;
  private fresh: ChatMessage[] = [];
  private wasReset = true;
  /** The permission mode or the /model pick changed since the last drain. */
  private modeChanged = false;

  constructor(path: string, fs: TranscriptFs = nodeTranscriptFs) {
    super(path, fs);
  }

  protected line(text: string): boolean {
    const parsed = parseChatLine(text);
    if (!parsed) return false;
    if (parsed.permissionMode && parsed.permissionMode !== this.permissionMode) {
      this.permissionMode = parsed.permissionMode;
      this.modeChanged = true;
    }
    if (parsed.modelSet && parsed.modelSet !== this.modelSet) {
      this.modelSet = parsed.modelSet;
      this.modeChanged = true;
    }
    const m = parsed.message;
    if (!m) return this.modeChanged;
    this.messages.push(m);
    if (this.messages.length > MAX_CHAT_MESSAGES) this.messages.splice(0, this.messages.length - MAX_CHAT_MESSAGES);
    if (!this.wasReset) {
      this.fresh.push(m);
      if (this.fresh.length > MAX_CHAT_MESSAGES) this.fresh.splice(0, this.fresh.length - MAX_CHAT_MESSAGES);
    }
    return true;
  }

  protected clear(): boolean {
    const had = this.messages.length > 0;
    this.messages = [];
    this.fresh = [];
    this.permissionMode = undefined;
    this.modelSet = undefined;
    this.wasReset = true;
    return had;
  }

  /** Messages added since the last drain, or the full list after a reset. */
  drain(): ChatDelta {
    const delta: ChatDelta = this.wasReset
      ? { reset: true, messages: [...this.messages] }
      : { reset: false, messages: this.fresh };
    if (this.wasReset || this.modeChanged) {
      if (this.permissionMode) delta.permissionMode = this.permissionMode;
      if (this.modelSet) delta.modelSet = this.modelSet;
    }
    this.fresh = [];
    this.wasReset = false;
    this.modeChanged = false;
    return delta;
  }
}
