import type { IPty, IDisposable } from 'node-pty';

/**
 * The pty of an exited direct session restored after an Argus restart: there
 * is no process behind it (direct agents never survive a quit), but the rest of
 * SessionManager treats every session as having a pty. Every call is accepted
 * and ignored; it never emits data or exit. Restart replaces it with a real one.
 */
export class InertPty implements IPty {
  readonly pid = 0;
  readonly process = '';
  handleFlowControl = false;
  cols: number;
  rows: number;
  private static readonly noop: IDisposable = { dispose() {} };

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
  }

  onData(): IDisposable { return InertPty.noop; }
  onExit(): IDisposable { return InertPty.noop; }
  write(): void {}
  resize(cols: number, rows: number): void { this.cols = cols; this.rows = rows; }
  clear(): void {}
  kill(): void {}
  pause(): void {}
  resume(): void {}
}
