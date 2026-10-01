/**
 * Incremental OSC 7 (`ESC ] 7 ; file://host/path BEL|ST`) reader: the shell
 * integration reports its cwd this way on every prompt. Output arrives in
 * arbitrary chunks, so an unterminated sequence at the end of a chunk is kept
 * and completed by the next one.
 */
const START = '\x1b]7;';
/** A real path report is short; past this the "sequence" is noise, not a cwd. */
const MAX_PENDING = 4096;

export class OscCwdParser {
  private pending = '';

  /** Feed raw pty output; returns the last cwd reported in it, or null. */
  feed(data: string): string | null {
    let text = this.pending + data;
    this.pending = '';
    let cwd: string | null = null;
    let at = text.indexOf(START);
    while (at !== -1) {
      const body = at + START.length;
      const bel = text.indexOf('\x07', body);
      const st = text.indexOf('\x1b\\', body);
      const end = bel === -1 ? st : st === -1 ? bel : Math.min(bel, st);
      if (end === -1) {
        const rest = text.slice(at);
        if (rest.length <= MAX_PENDING) this.pending = rest;
        break;
      }
      const parsed = parseFileUrl(text.slice(body, end));
      if (parsed) cwd = parsed;
      text = text.slice(end + (end === bel ? 1 : 2));
      at = text.indexOf(START);
    }
    return cwd;
  }
}

/** `file://host/abs/path` (percent-encoded) → `/abs/path`; anything else → null. */
export function parseFileUrl(url: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(url);
  if (!m) return null;
  let p = m[1];
  try {
    p = decodeURIComponent(p);
  } catch {
    /* a stray % — keep the raw path */
  }
  return p.includes('\0') ? null : p;
}
