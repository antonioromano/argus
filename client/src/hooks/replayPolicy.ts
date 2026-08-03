/**
 * Who gets realigned, and at what cost to the reader.
 *
 * The server serves two frame flavors (see ReplayFlavor in SessionManager):
 * history-bearing frames open with `\x1b[3J`, which erases the client's own
 * scrollback and snaps the viewport to the bottom; screen-only `resync` frames
 * do not. Every rule below follows from that one difference, so they live here
 * rather than as inline conditionals in useTerminal.
 */

/** `undefined` is the wire default and means `join`. */
export type ReplayReason = 'join' | 'refresh' | 'resync' | undefined;

/**
 * Paint an incoming replay frame, or drop it to protect the reader's position?
 * Only an unsolicited, history-bearing frame is ever worth dropping: a join
 * frame is mandatory (skip it and the terminal stays blank or garbled), and a
 * resync frame costs the reader nothing.
 */
export function shouldPaintReplay(reason: ReplayReason, scrolledUp: boolean): boolean {
  if (reason === 'refresh') return !scrolledUp;
  return true;
}

/**
 * Ask the server to realign this screen? Being scrolled up is deliberately NOT
 * a veto — a screen-only frame leaves the scrollback intact, so the old
 * trade-off between "aligned" and "keeps my place" is gone.
 *
 * The alternate buffer stays exempt: it has no scrollback to preserve and its
 * frames must re-emit the buffer switch, so the server degrades a resync there
 * to a full frame — which is the flicker this avoids.
 */
export function shouldRequestResync(state: {
  bufferType: 'normal' | 'alternate';
  scrolledUp: boolean;
}): boolean {
  return state.bufferType === 'normal';
}
