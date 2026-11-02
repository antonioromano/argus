import type { ChatBlock, ChatMessage, ChatQueue } from '@argus/shared';

/**
 * A prompt sent from the composer, shown at once until Claude Code has it
 * (F3, F8): recorded in the transcript, or, sent while Claude runs, listed in
 * its queue (ChatQueue, read from the transcript's queue entries). Both are
 * counted, never matched by text.
 */
export interface Pending {
  id: string;
  blocks: ChatBlock[];
  /** Shown until the transcript holds this many user messages. */
  at: number;
  /** Sent while Claude was running: shown until the queue's `seq` reaches this. */
  queueAt?: number;
  /** Stop was pressed while it was still unrecorded. */
  stopped?: boolean;
}

/** User messages as `at` counts them: the server's command echoes come and go. */
export function userCountOf(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) if (m.role === 'user' && !m.echo) n++;
  return n;
}

/**
 * A just-sent prompt. Every prompt still shown (queued or pending) becomes a
 * user message before this one; one sent while running is also the next
 * prompt Claude Code queues after the ones already pending.
 */
export function newPending(id: string, blocks: ChatBlock[], cur: Pending[], userCount: number, queued: number, queue: ChatQueue | undefined, running: boolean): Pending {
  const at = userCount + queued + cur.length + 1;
  if (!running) return { id, blocks, at };
  const after = cur.reduce((max, p) => Math.max(max, p.queueAt ?? 0), queue?.seq ?? 0);
  return { id, blocks, at, queueAt: after + 1 };
}

/** The prompts still to show: neither recorded nor in Claude Code's queue yet. */
export function openPending(pending: Pending[], userCount: number, queueSeq: number): Pending[] {
  if (pending.length === 0) return pending;
  const open = pending.filter((p) => p.at > userCount && (p.queueAt === undefined || queueSeq < p.queueAt));
  return open.length === pending.length ? pending : open;
}

/**
 * The prompt a new session was started with (F15), shown until the transcript
 * records its first prompt: Claude Code writes its first entry only once it
 * has started. Nothing once a prompt is recorded (the conversation moved past
 * it).
 */
export function launchPending(id: string, prompt: { text: string; clipped?: boolean }, userCount: number): Pending | null {
  if (userCount > 0 || !prompt.text.trim()) return null;
  const text = prompt.clipped ? `${prompt.text.trimEnd()}…` : prompt.text;
  return { id, blocks: [{ kind: 'text', text }], at: 1 };
}
