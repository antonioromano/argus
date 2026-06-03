import { useState, useRef } from 'react';
import { ArrowUp } from 'lucide-react';
import { KEY } from './focusKeys.js';

interface ComposeBarProps {
  send: (data: string) => void;
}

/** Prose compose surface — the only element that intentionally raises the iOS
 *  keyboard (the terminal's own helper textarea is neutered in useTerminal).
 *  Submit sends a carriage return (claude executes); composed newlines become
 *  ESC+CR so multi-line messages insert lines then submit. */
export function ComposeBar({ send }: ComposeBarProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    if (!text.trim()) return;
    send(text.replace(/\n/g, KEY.newline) + KEY.enter);
    setText('');
    const el = inputRef.current;
    if (el) el.style.height = 'auto';
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 'var(--s-2)',
        padding: 'var(--s-2) var(--s-3)',
        paddingBottom: 'calc(var(--s-2) + env(safe-area-inset-bottom, 0px))',
        background: 'var(--bg-1)',
        borderTop: '1px solid var(--line-2)',
        flexShrink: 0,
      }}
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
        aria-label="Send"
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
      >
        <ArrowUp size={16} strokeWidth={2} />
      </button>
    </form>
  );
}
