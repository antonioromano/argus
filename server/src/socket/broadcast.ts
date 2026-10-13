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

export interface BroadcastTarget {
  /** Live (non-exited) sessions get the write; exited ones are skipped. */
  isLive(id: string): boolean;
  write(id: string, data: string): void;
}

export function runBroadcast(
  req: ValidBroadcast,
  target: BroadcastTarget,
  schedule: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms); },
): BroadcastResult {
  let sent = 0;
  let skipped = 0;
  const delivered: string[] = [];
  for (const id of req.sessionIds) {
    if (!target.isLive(id)) {
      skipped++;
      continue;
    }
    try {
      if (req.text) target.write(id, req.text);
      delivered.push(id);
      sent++;
    } catch {
      skipped++; // exited between the check and the write
    }
  }
  if (req.enter && delivered.length > 0) {
    const send = () => {
      for (const id of delivered) {
        try { target.write(id, '\r'); } catch { /* gone meanwhile */ }
      }
    };
    if (req.text) schedule(send, BROADCAST_ENTER_DELAY_MS);
    else send();
  }
  return { ok: true, sent, skipped };
}
