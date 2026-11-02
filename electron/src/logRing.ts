/**
 * The recent-warnings tail for Help → Copy Diagnostics (plan 002).
 *
 * The server runs inside Electron main and logs with console.*, which a
 * Finder-launched app sends nowhere. Rather than add a log file (and its
 * growth), main keeps the last few hundred warn/error lines in memory. The
 * capture wraps console.warn / console.error and still calls the originals.
 * Redaction happens later, in the server's AppDiagnostics, for every line.
 */
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { format } from 'node:util';

export type LogLevel = 'warn' | 'error';

export interface LogRing {
  push(level: LogLevel, args: unknown[]): void;
  /** The newest `n` lines, oldest first. */
  tail(n?: number): string[];
}

const LINE_MAX = 500;

export function createLogRing(cap = 200, now: () => Date = () => new Date()): LogRing {
  const lines: string[] = [];
  return {
    push(level, args) {
      // One line per entry: a stack trace becomes " | "-joined frames.
      let msg = format(...args).replace(/\s*\n\s*/g, ' | ');
      if (msg.length > LINE_MAX) msg = `${msg.slice(0, LINE_MAX - 1)}…`;
      lines.push(`${now().toISOString()} ${level} ${msg}`);
      if (lines.length > cap) lines.splice(0, lines.length - cap);
    },
    tail(n = cap) {
      return n <= 0 ? [] : lines.slice(-n);
    },
  };
}

type ConsoleLike = Pick<Console, 'warn' | 'error'>;

/** Tee console.warn / console.error into the ring. Returns the uninstall. */
export function installConsoleCapture(ring: LogRing, con: ConsoleLike = console): () => void {
  const { warn, error } = con;
  con.warn = (...args: unknown[]) => {
    try { ring.push('warn', args); } catch { /* never let logging throw */ }
    warn.apply(con, args);
  };
  con.error = (...args: unknown[]) => {
    try { ring.push('error', args); } catch { /* never let logging throw */ }
    error.apply(con, args);
  };
  return () => {
    con.warn = warn;
    con.error = error;
  };
}

/** The last `n` lines of a file, reading at most its final `maxBytes`. Missing file → []. */
export function readTail(file: string, n: number, maxBytes = 64 * 1024): string[] {
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch {
    return [];
  }
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    if (len < size) lines.shift(); // the first line was cut mid-way
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.slice(-n);
  } catch {
    return [];
  } finally {
    closeSync(fd);
  }
}
