import type { RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, CornerDownLeft } from 'lucide-react';
import { KEY, arrow, type ArrowDir } from './focusKeys.js';

interface KeyStripProps {
  terminalRef: RefObject<Terminal | null>;
  send: (data: string) => void;
}

function tap(send: (d: string) => void, data: string) {
  navigator.vibrate?.(8);
  send(data);
}

/** Persistent control row for driving claude's TUI from a phone: arrow keys
 *  (DECCKM-aware), Enter, Esc, Tab, Ctrl-C. Arrow encoding is resolved at press
 *  time from `terminal.modes.applicationCursorKeysMode` so menus navigate whether
 *  or not claude has flipped into application-cursor mode. */
export function KeyStrip({ terminalRef, send }: KeyStripProps) {
  const sendArrow = (dir: ArrowDir) => {
    const appCursor = terminalRef.current?.modes.applicationCursorKeysMode ?? false;
    tap(send, arrow(dir, appCursor));
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-2)',
        padding: 'var(--s-2) var(--s-3)',
        background: 'var(--bg-1)',
        borderTop: '1px solid var(--line-2)',
        flexShrink: 0,
        overflowX: 'auto',
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
      }}
    >
      <KeyButton label="Esc" onPress={() => tap(send, KEY.esc)} />
      <KeyButton label="Tab" onPress={() => tap(send, KEY.tab)} />

      <Divider />

      <KeyButton aria="Left" onPress={() => sendArrow('D')}><ArrowLeft size={18} strokeWidth={2} /></KeyButton>
      <KeyButton aria="Up" onPress={() => sendArrow('A')}><ArrowUp size={18} strokeWidth={2} /></KeyButton>
      <KeyButton aria="Down" onPress={() => sendArrow('B')}><ArrowDown size={18} strokeWidth={2} /></KeyButton>
      <KeyButton aria="Right" onPress={() => sendArrow('C')}><ArrowRight size={18} strokeWidth={2} /></KeyButton>

      <Divider />

      <KeyButton label="^C" danger onPress={() => tap(send, KEY.ctrlC)} />
      <KeyButton aria="Enter" accent onPress={() => tap(send, KEY.enter)}><CornerDownLeft size={18} strokeWidth={2} /></KeyButton>
    </div>
  );
}

function Divider() {
  return <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line-2)', flexShrink: 0, margin: '4px 2px' }} />;
}

interface KeyButtonProps {
  label?: string;
  aria?: string;
  accent?: boolean;
  danger?: boolean;
  onPress: () => void;
  children?: React.ReactNode;
}

function KeyButton({ label, aria, accent, danger, onPress, children }: KeyButtonProps) {
  const color = accent ? 'var(--accent)' : danger ? 'var(--danger)' : 'var(--fg-1)';
  const border = accent
    ? '1px solid var(--accent-edge)'
    : danger
      ? '1px solid color-mix(in srgb, var(--danger) 33%, transparent)'
      : '1px solid var(--line-2)';
  const bg = accent ? 'var(--accent-bg)' : danger ? 'var(--danger-bg)' : 'var(--bg-2)';
  return (
    <button
      onClick={onPress}
      aria-label={aria ?? label}
      style={{
        minWidth: 44,
        height: 44,
        padding: '0 12px',
        borderRadius: 'var(--r-2)',
        background: bg,
        color,
        border,
        cursor: 'pointer',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-tiny)',
        fontWeight: 600,
        letterSpacing: 'var(--tracking-eye)',
      }}
    >
      {children ?? label}
    </button>
  );
}
