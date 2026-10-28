import type { ChatBlock, ChatMessage } from '@argus/shared';

/**
 * A prompt sent from the composer, shown until the transcript records it (F3,
 * F8). Claude Code records a prompt sent while it is idle at once; one sent
 * while it is running is queued and recorded only when Claude reads it —
 * as a user entry when the turn ends, or as a `queued_command` attachment
 * mid-turn (ChatTail turns both into user messages).
 */
export interface Pending {
  id: string;
  blocks: ChatBlock[];
  /** The typed text, whitespace collapsed (keyOf); '' when only attachments were sent. */
  key: string;
  /** Sent while Claude was running: Claude Code queues it. */
  queued: boolean;
  /** The last recorded user message when it was sent (null: none yet). */
  after: string | null;
  /** Stop was pressed while it was still unrecorded. */
  stopped?: boolean;
  /** Claude went idle without reading it: the queue was dropped. */
  discarded?: boolean;
  /** The last recorded user message when it was stopped or discarded. */
  markedAfter?: string | null;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * What the transcript's text of a prompt will contain. The composer sends
 * attachment paths, then the typed text, and previews the typed text first.
 */
export function keyOf(text: string, preview: ChatBlock[]): string {
  const first = preview[0];
  return first?.kind === 'text' && text.endsWith(first.text) ? norm(first.text) : '';
}

/** A recorded message's text, as ChatTail cleaned it (F2), whitespace collapsed. */
function textOf(m: ChatMessage): string {
  return norm(m.blocks.map((b) => (b.kind === 'text' ? b.text : '')).join(' '));
}

/** `key` is a whole-word part of `text`: after attachment paths, or merged with other queued prompts. */
function contains(text: string, key: string): boolean {
  return text.startsWith(`${key} `) || text.endsWith(` ${key}`) || text.includes(` ${key} `);
}

/**
 * The prompts still to show, in send order: those the transcript has not
 * recorded yet. Each recorded user message answers at most one prompt with
 * the same text, and only one recorded after it was sent and after the prompt
 * sent before it, so a prompt sent twice is shown until both are recorded and
 * never twice. A stopped or discarded prompt is dropped once the
 * conversation moves on past it.
 */
export function openPending(pending: Pending[], messages: ChatMessage[]): Pending[] {
  if (pending.length === 0) return pending;
  const users = messages.filter((m) => m.role === 'user' && !m.echo);
  const texts = users.map(textOf);
  const indexOf = (id: string | null | undefined) => (id ? users.findIndex((u) => u.id === id) : -1);
  const claimed = new Set<number>();
  let cursor = -1;
  const open: Pending[] = [];
  for (const p of pending) {
    const from = Math.max(cursor, indexOf(p.after) + 1, 0);
    let hit = -1;
    for (let i = from; i < users.length && hit < 0; i++) {
      if (!claimed.has(i) && (!p.key || texts[i] === p.key)) hit = i;
    }
    // Typed text after attachment paths, or several queued prompts in one entry.
    for (let i = from; p.key && i < users.length && hit < 0; i++) {
      if (contains(texts[i], p.key)) hit = i;
    }
    if (hit >= 0) {
      claimed.add(hit);
      cursor = hit;
      continue;
    }
    if ((p.stopped || p.discarded) && users.length - 1 > indexOf(p.markedAfter)) continue;
    // Sent after a prompt that settled: its record comes later still. Kept
    // in `after`, since the settled prompt (and its claim) is pruned.
    open.push(cursor > indexOf(p.after) ? { ...p, after: users[cursor].id } : p);
  }
  return open.length === pending.length ? pending : open;
}

/** The id of the last recorded user message, for `after` / `markedAfter`. */
export function lastUserId(messages: ChatMessage[]): string | null {
  return messages.findLast((m) => m.role === 'user' && !m.echo)?.id ?? null;
}
