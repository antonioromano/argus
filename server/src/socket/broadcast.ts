import type { BroadcastResult } from '@argus/shared';
import { BROADCAST_MAX_TARGETS, BROADCAST_MAX_TEXT } from '../constants/broadcast.js';

/**
 * Broadcast input (F4): one line of text typed into several sessions at once.
 *
 * Every target goes through the same SessionManager.writeToSession as a
 * keystroke from `session:input`, so done-acknowledgement and the exited guard
 * behave exactly as if the user had typed into each shell.
 */

export interface ValidBroadcast {
  ok: true;
  sessionIds: string[];
  text: string;
  enter: boolean;
}

/** C0 controls and DEL. Tab is allowed; newlines are not (single-line input). */
const CONTROL_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f]/;

export function validateBroadcast(
  payload: unknown,
  sessionExists: (id: string) => boolean,
): ValidBroadcast | { ok: false; error: string } {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'Invalid request' };
  const { sessionIds, text, enter } = payload as Record<string, unknown>;
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) return { ok: false, error: 'Pick at least one session' };
  if (sessionIds.length > BROADCAST_MAX_TARGETS) return { ok: false, error: `At most ${BROADCAST_MAX_TARGETS} sessions per broadcast` };
  if (!sessionIds.every((id): id is string => typeof id === 'string')) return { ok: false, error: 'Invalid session id' };
  const ids = [...new Set(sessionIds)];
  const unknown = ids.filter((id) => !sessionExists(id));
  if (unknown.length > 0) return { ok: false, error: `Unknown session: ${unknown[0]}` };
  if (typeof text !== 'string') return { ok: false, error: 'Text is required' };
  if (text.length > BROADCAST_MAX_TEXT) return { ok: false, error: `Text is longer than ${BROADCAST_MAX_TEXT} characters` };
  if (CONTROL_CHARS.test(text)) return { ok: false, error: 'Text must be a single line without control characters' };
  const withEnter = enter === true;
  if (text.length === 0 && !withEnter) return { ok: false, error: 'Nothing to send' };
  return { ok: true, sessionIds: ids, text, enter: withEnter };
}

/** Sliding-window limit: at most `max` events per `windowMs`. */
export class SlidingWindowLimiter {
  private hits: number[] = [];
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {}

  take(): boolean {
    const t = this.now();
    this.hits = this.hits.filter((h) => t - h < this.windowMs);
    if (this.hits.length >= this.max) return false;
    this.hits.push(t);
    return true;
  }
}

/** Broadcasts per socket: generous for a human, a wall for a runaway loop. */
export const BROADCAST_RATE = { max: 5, windowMs: 10_000 };

/**
 * Delay between the text and its Enter. A TUI agent (Claude's Ink input)
 * reads text and CR arriving in one chunk as a paste and inserts a newline
 * instead of submitting; a separate write a moment later is a real keypress.
 */
export const BROADCAST_ENTER_DELAY_MS = 60;

/**
 * Per-session input ordering. A broadcast's Enter is written a moment after
 * its text (see BROADCAST_ENTER_DELAY_MS); anything else written to that
 * session meanwhile — the user typing, a second broadcast — waits behind the
 * pending Enter instead of landing between the text and its Enter. A session
 * with nothing pending is written straight through, synchronously.
 */
export class SessionInputQueue {
  private queues = new Map<string, { ops: Array<{ data: string; pauseAfter: number }>; paused: boolean }>();

  constructor(
    private writeNow: (id: string, data: string) => void,
    private schedule: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms); },
  ) {}

  /** Write `data`, after whatever is still pending for this session. */
  write(id: string, data: string, pauseAfter = 0): void {
    let q = this.queues.get(id);
    if (!q) {
      if (pauseAfter === 0) {
        this.safeWrite(id, data); // the common case: nothing pending
        return;
      }
      q = { ops: [], paused: false };
      this.queues.set(id, q);
    }
    q.ops.push({ data, pauseAfter });
    if (!q.paused) this.drain(id);
  }

  /** True while an Enter (or other paused op) is still pending for the session. */
  isPending(id: string): boolean {
    return this.queues.has(id);
  }

  private drain(id: string): void {
    const q = this.queues.get(id);
    if (!q) return;
    while (q.ops.length > 0) {
      const op = q.ops.shift()!;
      this.safeWrite(id, op.data);
      if (op.pauseAfter > 0) {
        q.paused = true;
        this.schedule(() => {
          q.paused = false;
          this.drain(id);
        }, op.pauseAfter);
        return;
      }
    }
    this.queues.delete(id);
  }

  private safeWrite(id: string, data: string): void {
    try {
      this.writeNow(id, data);
    } catch {
      /* session exited or was deleted meanwhile */
    }
  }
}

/**
 * Queue the broadcast on every live target: text, a short pause, then Enter
 * (when asked). Exited and missing sessions are skipped and counted.
 */
export function runBroadcast(
  req: ValidBroadcast,
  isLive: (id: string) => boolean,
  queue: SessionInputQueue,
): BroadcastResult {
  let sent = 0;
  let skipped = 0;
  for (const id of req.sessionIds) {
    if (!isLive(id)) {
      skipped++;
      continue;
    }
    if (req.text) queue.write(id, req.text, req.enter ? BROADCAST_ENTER_DELAY_MS : 0);
    if (req.enter) queue.write(id, '\r');
    sent++;
  }
  return { ok: true, sent, skipped };
}
