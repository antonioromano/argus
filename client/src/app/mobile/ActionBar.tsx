import { useState, useRef, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';
import type { SessionInfo } from '@argus/shared';
import { useSocket } from '../../hooks/useSocket.js';

interface ActionBarProps {
  session: SessionInfo;
  lastRawLine: string;
}

interface Chip {
  label: string;
  value: string;
  kind: 'yes' | 'no' | 'stop' | 'default';
}

function detect(line: string, status: string): Chip[] {
  const chips: Chip[] = [];
  if (/\(y\/n\)/i.test(line)) {
    chips.push({ label: 'y · YES', value: 'y\n', kind: 'yes' });
    chips.push({ label: 'n · NO', value: 'n\n', kind: 'no' });
  } else if (/\(yes\/no\)/i.test(line)) {
    chips.push({ label: 'YES', value: 'yes\n', kind: 'yes' });
    chips.push({ label: 'NO', value: 'no\n', kind: 'no' });
  } else if (/press enter/i.test(line) || /\[enter\]/i.test(line)) {
    chips.push({ label: 'CONTINUE ↵', value: '\r', kind: 'default' });
  }
  if (status === 'waiting' || status === 'running') {
    chips.push({ label: '⏹ STOP', value: '\x03', kind: 'stop' });
  }
  return chips;
}

function chipStyle(kind: Chip['kind']): React.CSSProperties {
  switch (kind) {
    case 'yes':
      return { background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent-edge)' };
    case 'no':
      return { background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 33%, transparent)' };
    case 'stop':
      return { background: 'var(--bg-3)', color: 'var(--fg-2)', border: '1px solid var(--line-2)' };
    default:
      return { background: 'var(--bg-2)', color: 'var(--fg-1)', border: '1px solid var(--line-2)' };
  }
}

export function ActionBar({ session, lastRawLine }: ActionBarProps) {
  const socket = useSocket();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chips = detect(lastRawLine, session.status);

  const send = (d: string) => socket.emit('session:input', { sessionId: session.id, data: d });
  const submit = () => {
    if (!text.trim()) return;
    send(text + '\n');
    setText('');
    const el = inputRef.current;
    if (el) el.style.height = 'auto';
  };

  // Auto-grow the textarea up to ~5 rows.
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };

  const chipsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (chipsRef.current) chipsRef.current.scrollLeft = 0;
  }, [chips.length]);

  return (
    <div
      style={{
        background: 'var(--bg-1)',
        borderTop: '1px solid var(--line-2)',
        paddingBottom: 'env(safe-area-inset-bottom, 16px)',
        flexShrink: 0,
      }}
    >
      {chips.length > 0 && (
        <div
          ref={chipsRef}
          className="mobile-chips-row"
          style={{
            display: 'flex',
            gap: 'var(--s-2)',
            padding: 'var(--s-2) var(--s-3) var(--s-1)',
            overflowX: 'auto',
            scrollbarWidth: 'none',
            WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
          }}
        >
          {chips.map((c) => (
            <button
              key={c.label}
              onClick={() => send(c.value)}
              style={{
                padding: '0 var(--s-3)',
                minHeight: 44,
                borderRadius: 'var(--r-2)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-tiny)',
                letterSpacing: 'var(--tracking-eye)',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                ...chipStyle(c.kind),
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s-2)', padding: 'var(--s-2) var(--s-3)' }}
      >
        <textarea
          ref={inputRef}
          value={text}
          rows={1}
          onChange={(e) => { setText(e.target.value); autoGrow(e.target); }}
          placeholder="Send message…"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="enter"
          style={{
            flex: 1,
            background: 'var(--bg-2)',
            border: '1px solid var(--line-2)',
            borderRadius: 'var(--r-2)',
            padding: '10px var(--s-3)',
            fontSize: 16,
            lineHeight: 1.4,
            fontFamily: 'var(--font-mono)',
            color: 'var(--fg-0)',
            outline: 'none',
            minHeight: 44,
            maxHeight: 132,
            resize: 'none',
            boxSizing: 'border-box',
          }}
        />
        <button
          type="submit"
          disabled={!text.trim()}
          style={{
            width: 44,
            height: 44,
            borderRadius: 'var(--r-2)',
            background: text.trim() ? 'var(--accent)' : 'var(--bg-3)',
            color: text.trim() ? 'var(--fg-on-accent)' : 'var(--fg-3)',
            border: 'none',
            cursor: text.trim() ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
          aria-label="Send"
        >
          <ArrowUp size={16} strokeWidth={2} />
        </button>
      </form>
    </div>
  );
}
