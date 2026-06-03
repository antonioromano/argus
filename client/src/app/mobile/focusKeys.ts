import type { CSSProperties } from 'react';

/** Raw byte sequences written to the pty (mirror desktop xterm output). */
export const KEY = {
  enter: '\r',
  esc: '\x1b',
  tab: '\t',
  ctrlC: '\x03',
  /** Insert a literal newline in claude's prompt (desktop Shift+Enter equivalent). */
  newline: '\x1b\r',
} as const;

export type ArrowDir = 'A' | 'B' | 'C' | 'D'; // up / down / right / left

/**
 * Arrow-key bytes. claude/Ink TUIs flip the terminal into application-cursor mode
 * (DECCKM, ESC[?1h), which expects ESC O x instead of ESC [ x. Read
 * `terminal.modes.applicationCursorKeysMode` at send time and pass it here.
 */
export function arrow(dir: ArrowDir, appCursor: boolean): string {
  return appCursor ? `\x1bO${dir}` : `\x1b[${dir}`;
}

export interface Chip {
  label: string;
  value: string;
  kind: 'yes' | 'no' | 'default';
}

/**
 * Parse the bottom terminal line for a recognizable prompt and surface quick-reply
 * chips. Ctrl-C/STOP intentionally lives in the persistent KeyStrip, not here.
 */
export function detect(line: string): Chip[] {
  const chips: Chip[] = [];
  if (/\(y\/n\)/i.test(line)) {
    chips.push({ label: 'y · YES', value: 'y\n', kind: 'yes' });
    chips.push({ label: 'n · NO', value: 'n\n', kind: 'no' });
  } else if (/\(yes\/no\)/i.test(line)) {
    chips.push({ label: 'YES', value: 'yes\n', kind: 'yes' });
    chips.push({ label: 'NO', value: 'no\n', kind: 'no' });
  } else if (/press enter/i.test(line) || /\[enter\]/i.test(line)) {
    chips.push({ label: 'CONTINUE ↵', value: KEY.enter, kind: 'default' });
  }
  return chips;
}

export function chipStyle(kind: Chip['kind']): CSSProperties {
  switch (kind) {
    case 'yes':
      return { background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent-edge)' };
    case 'no':
      return { background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 33%, transparent)' };
    default:
      return { background: 'var(--bg-2)', color: 'var(--fg-1)', border: '1px solid var(--line-2)' };
  }
}
