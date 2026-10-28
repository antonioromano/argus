import type { ChatBlock, ChatCommand, ChatMessage } from '@argus/shared';
import { JsonlTailer, nodeTranscriptFs, type TranscriptFs } from './JsonlTailer.js';
import { toolBlockOf, toolResultsOf, withResult, type ToolResult } from './chatTools.js';

/**
 * Chat view (B1): turns Claude Code transcript entries into chat messages.
 *
 * The transcript format is not a public API, so the parser is deliberately
 * tolerant: a malformed line, an unknown entry type or an unexpected shape is
 * skipped (or rendered as an `unknown` block), never thrown. Only main-thread
 * user, assistant and local-command entries become messages, plus the
 * prompts the user queued that Claude read mid-turn (queuedPromptMessage);
 * tool results are folded into the tool call they answer (F7); other
 * attachments, subagent (sidechain) turns and harness-injected meta prompts
 * are dropped.
 */

/** Messages kept per transcript; older ones fall off the front. */
export const MAX_CHAT_MESSAGES = 2000;
/** Longest text block sent to clients; longer text is cut with a marker. */
export const MAX_CHAT_TEXT = 100_000;
const MAX_NAME = 80;
const TRUNCATED = '\n\n… (truncated)';

/** Harness-only wrappers stripped from user text (never typed by the user). */
const HIDDEN_TAGS = ['system-reminder', 'task-notification', 'local-command-caveat', 'local-command-stdout', 'local-command-stderr', 'bash-stdout', 'bash-stderr'];
const HIDDEN_RE = new RegExp(`<(${HIDDEN_TAGS.join('|')})>[\\s\\S]*?</\\1>`, 'g');
/** Claude Code wraps a pasted text in `<pasted_content id="…">…</pasted_content id="…">`; the text is kept. */
const PASTED_RE = /<pasted_content\b[^>]*>\n?([\s\S]*?)\n?<\/pasted_content\b[^>]*>/g;
/** The placeholder Claude Code leaves where an attached image went. */
const IMAGE_REF_RE = /\[Image #\d+\][ \t]*/g;
/** A path of Argus's own uploaded clipboard images (routes/chatImages), quoted or not. */
const ARGUS_IMAGE_RE = /(?:"[^"\n]*|[^\s"]*)\/argus-chat-images\/[\w-]+\.(?:png|jpe?g|gif|webp)"?[ \t]*/g;
/** An absolute image path in a prompt (an attached file Claude Code reads as an image). */
const IMAGE_PATH_RE = /"(\/[^"\n]+\.(?:png|jpe?g|gif|webp))"|(?<![^\s])(\/[^\s"]+\.(?:png|jpe?g|gif|webp))(?![^\s])/gi;
/** What Claude Code records when a turn is stopped mid-reply. */
const INTERRUPTED_RE = /^\[Request interrupted by user[^\]\n]*\]$/;
const STOPPED_TEXT = 'Stopped';
/** Command output wrappers, shown as collapsed output blocks. */
const OUTPUT_RE = /<(local-command|bash)-(stdout|stderr)>([\s\S]*?)<\/\1-\2>/g;
/** Claude Code writes command output as the whole entry, so the wrapper opens it. */
const HAS_OUTPUT_RE = /^\s*<(?:local-command|bash)-(?:stdout|stderr)>/;
/** Machine-readable trailers some command output carries (forked skills). */
const OUTPUT_NOISE_RE = /<forked-skill-launch>[\s\S]*?<\/forked-skill-launch>/g;
// eslint-disable-next-line no-control-regex -- stripping terminal escapes is the point
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
/** What Claude Code writes for a command that printed nothing. */
const NO_CONTENT = '(no content)';

function clip(text: string): string {
  return text.length > MAX_CHAT_TEXT ? text.slice(0, MAX_CHAT_TEXT) + TRUNCATED : text;
}

/** `<command-name>/model</command-name>…<command-args>opus</command-args>` → `/model` + `opus`. */
function commandOf(raw: string): { name: string; args?: string } | undefined {
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(raw)?.[1]?.trim();
  if (name) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(raw)?.[1]?.trim();
    return args ? { name: name.slice(0, MAX_NAME), args: clip(args) } : { name: name.slice(0, MAX_NAME) };
  }
  const bash = /<bash-input>([\s\S]*?)<\/bash-input>/.exec(raw)?.[1]?.trim();
  return bash ? { name: '!', args: clip(bash) } : undefined;
}

/** The output blocks of a `<local-command-stdout>`-style entry (empty output dropped). */
function outputsOf(raw: string): ChatBlock[] {
  const out: ChatBlock[] = [];
  for (const m of raw.matchAll(OUTPUT_RE)) {
    const text = m[3].replace(OUTPUT_NOISE_RE, '').replace(ANSI_RE, '').trim();
    if (text && text !== NO_CONTENT) out.push({ kind: 'output', text: clip(text), stream: m[2] as 'stdout' | 'stderr' });
  }
  return out;
}

/**
 * The user-visible part of a user prompt: harness wrappers removed, a slash
 * command shown as typed (`/model opus`), a `!` bash command as `! cmd`.
 * A pasted text is unwrapped and Argus's temp image paths dropped; with
 * `hasImage` (the entry carries the image itself) so are `[Image #N]` markers.
 */
export function cleanUserText(raw: string, hasImage = false): string {
  const command = commandOf(raw);
  if (command) return [command.name, command.args].filter(Boolean).join(' ');
  let text = raw.replace(HIDDEN_RE, '').replace(PASTED_RE, '$1').replace(ARGUS_IMAGE_RE, '');
  if (hasImage) text = text.replace(IMAGE_REF_RE, '');
  return text.trim();
}

/**
 * The image paths of a prompt, in order; Argus's temp images are `undefined`:
 * they sit outside every session folder, so no scoped route can read them.
 */
function imagePathsOf(raw: string): (string | undefined)[] {
  return Array.from(raw.matchAll(IMAGE_PATH_RE), (m) => {
    const p = m[1] ?? m[2];
    return p.includes('/argus-chat-images/') ? undefined : p;
  });
}

/**
 * Blocks of a user entry whose content is a string: a command, command
 * output, or plain text with the harness wrappers removed.
 */
function userStringBlocks(raw: string): ChatBlock[] {
  const command = commandOf(raw);
  if (command) return [{ kind: 'command', ...command }];
  if (HAS_OUTPUT_RE.test(raw)) return outputsOf(raw);
  const text = cleanUserText(raw);
  if (INTERRUPTED_RE.test(text)) return [{ kind: 'notice', text: STOPPED_TEXT }];
  return text ? [{ kind: 'text', text: clip(text) }] : [];
}

function parseTs(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

function blocksOf(role: 'user' | 'assistant', content: unknown, cwd?: string): ChatBlock[] {
  if (typeof content === 'string') {
    if (role === 'user') return userStringBlocks(content);
    return content ? [{ kind: 'text', text: clip(content) }] : [];
  }
  if (!Array.isArray(content)) return [];
  const out: ChatBlock[] = [];
  const hasImage = content.some((b) => b?.type === 'image');
  // An image block carries no path; the prompt text names the file, in order.
  const paths = role === 'user' && hasImage ? content.flatMap((b) => (b?.type === 'text' && typeof b.text === 'string' ? imagePathsOf(b.text) : [])) : [];
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    const type = typeof b.type === 'string' ? b.type : '';
    switch (type) {
      case 'text': {
        if (typeof b.text !== 'string') break;
        const text = role === 'user' ? cleanUserText(b.text, hasImage) : b.text.trim();
        if (role === 'user' && INTERRUPTED_RE.test(text)) out.push({ kind: 'notice', text: STOPPED_TEXT });
        else if (text) out.push({ kind: 'text', text: clip(text) });
        break;
      }
      case 'tool_use':
        out.push(toolBlockOf(b, cwd));
        break;
      case 'image': {
        const path = paths.shift();
        out.push(path ? { kind: 'image', path } : { kind: 'image' });
        break;
      }
      // A result is joined to its call (ChatLine.toolResults); thinking is often redacted.
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

/** Skills kept from a listing; descriptions are clipped to their first line. */
export const MAX_CHAT_COMMANDS = 400;
const MAX_COMMAND_DESC = 160;
const SKILL_ROW_RE = /^- ([\w][\w:.-]{0,79}): ?(.*)$/;

/** `- name: description` rows of a skill listing (continuation lines ignored). */
export function parseSkillListing(content: string): ChatCommand[] {
  const out: ChatCommand[] = [];
  for (const row of content.split('\n')) {
    const m = SKILL_ROW_RE.exec(row);
    if (!m) continue;
    const desc = m[2].trim();
    out.push(desc ? { name: m[1], description: desc.length > MAX_COMMAND_DESC ? `${desc.slice(0, MAX_COMMAND_DESC - 1)}…` : desc } : { name: m[1] });
    if (out.length >= MAX_CHAT_COMMANDS) break;
  }
  return out;
}

/** What one transcript line contributes to the chat. */
export interface ChatLine {
  message?: ChatMessage;
  /** Permission mode recorded on a main-thread user entry. */
  permissionMode?: string;
  /** Model display name from a `/model` reply. */
  modelSet?: string;
  /** Skills from a skill listing; `skillsReplace` when it is a full (initial) listing. */
  skills?: ChatCommand[];
  skillsReplace?: boolean;
  /** Results of earlier tool calls, to fold into the steps they answer. */
  toolResults?: ToolResult[];
}

/**
 * One transcript line → its chat message and/or permission mode, or undefined
 * when it carries neither (other entry types, malformed JSON, …).
 */
export function parseChatLine(text: string): ChatLine | undefined {
  // Cheap prefilter: most lines are attachments, snapshots and tool results.
  const listing = text.includes('"skill_listing"');
  const queued = text.includes('"queued_command"');
  if (!listing && !queued && !text.includes('"user"') && !text.includes('"assistant"') && !text.includes('"system"')) return undefined;
  let entry: any;
  try {
    entry = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!entry || typeof entry !== 'object') return undefined;
  if (listing && entry.type === 'attachment') {
    const a = entry.attachment;
    if (entry.isSidechain || a?.type !== 'skill_listing' || typeof a.content !== 'string') return undefined;
    return { skills: parseSkillListing(a.content), skillsReplace: a.isInitial !== false };
  }
  if (queued && entry.type === 'attachment') {
    const message = queuedPromptMessage(entry);
    return message ? { message } : undefined;
  }
  const type = entry.type;
  if (type !== 'user' && type !== 'assistant' && type !== 'system') return undefined;
  if (entry.isSidechain) return undefined;
  const permissionMode =
    type === 'user' && typeof entry.permissionMode === 'string' && entry.permissionMode
      ? entry.permissionMode.slice(0, MAX_MODE)
      : undefined;
  // A system entry keeps its text in `content`; user/assistant ones in `message.content`.
  const content = type === 'system' ? entry.content : entry.message?.content;
  const modelSet = type !== 'assistant' && typeof content === 'string' ? MODEL_SET_RE.exec(content)?.[1]?.trim() : undefined;
  const message = type === 'system' ? systemMessage(entry) : toMessage(entry, type);
  const toolResults = type === 'user' && !entry.isSidechain ? toolResultsOf(content, entry.toolUseResult) : [];
  if (!message && !permissionMode && !modelSet && toolResults.length === 0) return undefined;
  const out: ChatLine = { message, permissionMode };
  if (modelSet) out.modelSet = modelSet;
  if (toolResults.length) out.toolResults = toolResults;
  return out;
}

/** One transcript line → a chat message, or undefined when it is not one. */
export function parseChatEntry(text: string): ChatMessage | undefined {
  return parseChatLine(text)?.message;
}

/** Commands are the user's; output and notices belong to neither side. */
function roleOf(type: 'user' | 'assistant', blocks: ChatBlock[]): ChatMessage['role'] {
  if (type === 'assistant') return 'assistant';
  return blocks.every((b) => b.kind === 'output' || b.kind === 'notice') ? 'system' : 'user';
}

function withMeta(entry: any, role: ChatMessage['role'], blocks: ChatBlock[]): ChatMessage {
  const out: ChatMessage = { id: entry.uuid.slice(0, 64), role, blocks };
  const ts = parseTs(entry.timestamp);
  if (ts !== undefined) out.ts = ts;
  return out;
}

function toMessage(entry: any, type: 'user' | 'assistant'): ChatMessage | undefined {
  if (entry.isSidechain || entry.isMeta || entry.isCompactSummary || entry.isVisibleInTranscriptOnly) return undefined;
  if (typeof entry.uuid !== 'string' || !entry.uuid) return undefined;
  const msg = entry.message;
  if (!msg || typeof msg !== 'object') return undefined;
  const blocks = blocksOf(type, msg.content, typeof entry.cwd === 'string' ? entry.cwd : undefined);
  if (blocks.length === 0) return undefined;
  return withMeta(entry, roleOf(type, blocks), blocks);
}

/**
 * A prompt typed while Claude was running is queued (a `queue-operation`
 * enqueue entry). Claude Code delivers it either as a normal user entry when
 * the turn ends, or, when it reads it mid-turn (alongside a tool result), only
 * as a `queued_command` attachment: no user entry follows. Background-task
 * notifications and messages from other sessions use the same attachment;
 * only the user's own prompts become messages.
 */
function queuedPromptMessage(entry: any): ChatMessage | undefined {
  const a = entry.attachment;
  if (entry.isSidechain || entry.isMeta || a?.type !== 'queued_command' || a.commandMode !== 'prompt') return undefined;
  if (a.origin?.kind !== undefined && a.origin.kind !== 'human') return undefined;
  if (typeof entry.uuid !== 'string' || !entry.uuid) return undefined;
  const blocks = blocksOf('user', a.prompt);
  if (blocks.length === 0) return undefined;
  return withMeta(entry, roleOf('user', blocks), blocks);
}

/**
 * Newer Claude Code versions record some local commands (a dismissed `/model`
 * picker, `/resume`, …) and their output as `system` entries instead of user
 * ones, plus one-line notices such as "Unknown command: /foo".
 */
function systemMessage(entry: any): ChatMessage | undefined {
  if (entry.isMeta || typeof entry.uuid !== 'string' || !entry.uuid) return undefined;
  if (typeof entry.content !== 'string') return undefined;
  if (entry.subtype === 'local_command') {
    const blocks = userStringBlocks(entry.content);
    if (blocks.length === 0 || blocks[0].kind === 'text') return undefined;
    return withMeta(entry, roleOf('user', blocks), blocks);
  }
  if (entry.subtype === 'informational') {
    const text = entry.content.replace(ANSI_RE, '').trim();
    return text ? withMeta(entry, 'system', [{ kind: 'notice', text: clip(text) }]) : undefined;
  }
  return undefined;
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
  /** Same, for the skills and custom commands. */
  commands?: ChatCommand[];
  /** Ids of echoes sent earlier that the transcript has now recorded (appends only). */
  removed?: string[];
}

function lastIndexOfId(list: ChatMessage[], id: string): number {
  for (let i = list.length - 1; i >= 0; i--) if (list[i].id === id) return i;
  return -1;
}

/** Tool calls awaiting their result per transcript; the oldest stay `pending`. */
const MAX_OPEN_TOOLS = 500;

/** Pending echoes kept per transcript; the oldest are forgotten (and stay shown). */
const MAX_ECHOES = 50;

/**
 * The command a Chat view message sends, when it is a single-line slash
 * command (`/model opus` → `/model` + `opus`); plain prompts get no echo,
 * since the transcript always records them.
 */
export function echoCommandOf(text: string): { name: string; args?: string } | undefined {
  const t = text.trim();
  if (!/^\/[^\s/]+(?:\s|$)/.test(t) || t.includes('\n')) return undefined;
  const space = t.search(/\s/);
  const name = (space < 0 ? t : t.slice(0, space)).slice(0, MAX_NAME);
  const args = space < 0 ? '' : t.slice(space).trim();
  return args ? { name, args: clip(args) } : { name };
}

/** Aliases Claude Code records under their canonical name. */
const COMMAND_ALIASES: Record<string, string> = {
  '/settings': '/config',
  '/quit': '/exit',
  '/bug': '/feedback',
  '/reset': '/clear',
  '/new': '/clear',
  '/continue': '/resume',
  '/allowed-tools': '/permissions',
};
/**
 * How soon after the echo a recorded command may answer it by prefix: Enter
 * on a partial name (`/compa`) runs the highlighted completion (`/compact`)
 * at once; a later command with that prefix is something else.
 */
export const ECHO_PREFIX_MS = 5000;

/** The recorded command `name` (at `at`) answers the echo of `echoName` sent at `sentAt`. */
function answersEcho(name: string, at: number, echoName: string, sentAt: number): boolean {
  const a = name.toLowerCase();
  const b = echoName.toLowerCase();
  if (a === b || a === COMMAND_ALIASES[b]) return true;
  return a.startsWith(b) && at >= sentAt && at - sentAt <= ECHO_PREFIX_MS;
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
  /** Skills and custom commands, from the latest listing(s). */
  commands?: ChatCommand[];
  private fresh: ChatMessage[] = [];
  private wasReset = true;
  /** The permission mode or the /model pick changed since the last drain. */
  private modeChanged = false;
  /** Echoes not yet matched by a recorded command, oldest first. */
  private echoes: { id: string; name: string; at: number }[] = [];
  private echoSeq = 0;
  /** Echo ids to drop on the client, collected for the next drain. */
  private removedIds: string[] = [];
  /** tool_use id → id of the message holding that call, until its result arrives. */
  private openTools = new Map<string, string>();

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
    if (parsed.skills) {
      // A later, non-initial listing adds skills; same-named ones are replaced.
      const keep = parsed.skillsReplace ? [] : (this.commands ?? []).filter((c) => !parsed.skills!.some((s) => s.name === c.name));
      this.commands = keep.concat(parsed.skills).slice(0, MAX_CHAT_COMMANDS);
      this.modeChanged = true;
    }
    const joined = parsed.toolResults ? this.joinResults(parsed.toolResults) : false;
    const m = parsed.message;
    if (!m) return this.modeChanged || joined;
    if (m.blocks[0]?.kind === 'command') this.settleEcho(m.blocks[0].name, m.ts ?? Date.now());
    for (const b of m.blocks) if (b.kind === 'tool' && b.id) this.openTool(b.id, m.id);
    this.messages.push(m);
    if (this.messages.length > MAX_CHAT_MESSAGES) this.messages.splice(0, this.messages.length - MAX_CHAT_MESSAGES);
    if (!this.wasReset) {
      this.fresh.push(m);
      if (this.fresh.length > MAX_CHAT_MESSAGES) this.fresh.splice(0, this.fresh.length - MAX_CHAT_MESSAGES);
    }
    return true;
  }

  private openTool(toolId: string, messageId: string): void {
    this.openTools.set(toolId, messageId);
    if (this.openTools.size > MAX_OPEN_TOOLS) this.openTools.delete(this.openTools.keys().next().value!);
  }

  /**
   * Fold tool results into the calls they answer. The message is replaced by
   * a copy (same id) and queued again, so a client that already has it swaps
   * it in place. Returns whether any call was found.
   */
  private joinResults(results: ToolResult[]): boolean {
    let any = false;
    for (const r of results) {
      const messageId = this.openTools.get(r.id);
      if (messageId === undefined) continue;
      this.openTools.delete(r.id);
      const at = lastIndexOfId(this.messages, messageId);
      if (at < 0) continue;
      const old = this.messages[at];
      const blocks = old.blocks.map((b) => (b.kind === 'tool' && b.id === r.id ? withResult(b, r) : b));
      const next: ChatMessage = { ...old, blocks };
      this.messages[at] = next;
      any = true;
      if (this.wasReset) continue;
      const inFresh = lastIndexOfId(this.fresh, messageId);
      if (inFresh >= 0) this.fresh[inFresh] = next;
      else this.fresh.push(next);
    }
    return any;
  }

  /**
   * Show a slash command sent from the Chat view right away. Claude Code
   * never records some commands (`/cost`, `/help`, a dismissed picker…), so
   * without this they would not appear at all; one it does record later
   * replaces its echo. Returns false when `text` gets no echo.
   */
  echo(text: string, now = Date.now()): boolean {
    const command = echoCommandOf(text);
    if (!command) return false;
    const m: ChatMessage = { id: `echo-${++this.echoSeq}`, role: 'user', ts: now, blocks: [{ kind: 'command', ...command }], echo: true };
    this.echoes.push({ id: m.id, name: command.name, at: now });
    if (this.echoes.length > MAX_ECHOES) this.echoes.shift();
    this.messages.push(m);
    if (this.messages.length > MAX_CHAT_MESSAGES) this.messages.splice(0, this.messages.length - MAX_CHAT_MESSAGES);
    if (!this.wasReset) this.fresh.push(m);
    return true;
  }

  /** A recorded command arrived: drop the oldest echo it answers. */
  private settleEcho(name: string, recordedAt: number): void {
    const i = this.echoes.findIndex((e) => answersEcho(name, recordedAt, e.name, e.at));
    if (i < 0) return;
    const [{ id }] = this.echoes.splice(i, 1);
    const at = this.messages.findIndex((x) => x.id === id);
    if (at >= 0) this.messages.splice(at, 1);
    const inFresh = this.fresh.findIndex((x) => x.id === id);
    // Not sent yet: just never send it; otherwise the client has to drop it.
    if (inFresh >= 0) this.fresh.splice(inFresh, 1);
    else if (!this.wasReset) this.removedIds.push(id);
  }

  protected clear(): boolean {
    const had = this.messages.length > 0;
    this.messages = [];
    this.fresh = [];
    this.echoes = [];
    this.removedIds = [];
    this.openTools.clear();
    this.permissionMode = undefined;
    this.modelSet = undefined;
    this.commands = undefined;
    this.wasReset = true;
    return had;
  }

  /** Messages added (or, for joined tool results, changed) since the last drain, or the full list after a reset. */
  drain(): ChatDelta {
    const delta: ChatDelta = this.wasReset
      ? { reset: true, messages: [...this.messages] }
      : { reset: false, messages: this.fresh };
    if (this.wasReset || this.modeChanged) {
      if (this.permissionMode) delta.permissionMode = this.permissionMode;
      if (this.modelSet) delta.modelSet = this.modelSet;
      if (this.commands) delta.commands = this.commands;
    }
    if (!this.wasReset && this.removedIds.length) delta.removed = this.removedIds;
    this.fresh = [];
    this.removedIds = [];
    this.wasReset = false;
    this.modeChanged = false;
    return delta;
  }
}
