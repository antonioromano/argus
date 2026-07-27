/**
 * Decides whether a measured terminal grid is worth telling the server about.
 *
 * Every distinct pty width makes the agent re-render its transcript hard-wrapped
 * at the new width, and the copies wrapped at the old width can't be reflowed or
 * erased — they stay in scrollback forever (and in the server's mirror, so they
 * survive every replay). So the cheapest fix for duplicated blocks is to send
 * fewer sizes:
 *
 * - repeats are dropped (xterm refits on visibility changes, the global
 *   `terminal:refit` event, sibling tiles mounting — most produce no grid change)
 * - sizes measured mid-drag are withheld: a divider drag with pauses otherwise
 *   walks the pty through every intermediate width, one duplicate each
 * - `force` exists for reconnect, where the server genuinely doesn't know our size
 *
 * A withheld size is never recorded as sent, so the size that lands when the drag
 * releases is still "new" and gets emitted.
 */
export class ResizeEmitGate {
  private last: { cols: number; rows: number } | null = null;

  /** True when the caller should emit `session:resize` for this grid. */
  request(cols: number, rows: number, opts?: { force?: boolean; suspended?: boolean }): boolean {
    if (opts?.force) {
      this.last = { cols, rows };
      return true;
    }
    if (opts?.suspended) return false;
    if (this.last && this.last.cols === cols && this.last.rows === rows) return false;
    this.last = { cols, rows };
    return true;
  }
}
