import { forwardRef } from 'react';
import { ArrowUp } from 'lucide-react';

interface ComposeBarProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  /** Hybrid: an editable textarea that raises the OS keyboard. Dual: a read-only
   *  display fed by the custom QWERTY (no native keyboard). */
  nativeInput: boolean;
}

const MAX_H = 132;

/** Textarea + send button. Extracted from the old ActionBar. fontSize:16 keeps
 *  iOS from zooming on focus; the field auto-grows up to ~5 rows. */
export const ComposeBar = forwardRef<HTMLTextAreaElement, ComposeBarProps>(
  ({ value, onChange, onSubmit, nativeInput }, ref) => {
    const autoGrow = (el: HTMLTextAreaElement) => {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, MAX_H)}px`;
    };
    const canSend = value.trim().length > 0;

    return (
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s-2)', padding: 'var(--s-2) var(--s-3)' }}
      >
        <textarea
          ref={ref}
          value={value}
          rows={1}
          readOnly={!nativeInput}
          onChange={(e) => { onChange(e.target.value); autoGrow(e.target); }}
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
            maxHeight: MAX_H,
            resize: 'none',
            boxSizing: 'border-box',
          }}
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          style={{
            width: 44,
            height: 44,
            borderRadius: 'var(--r-2)',
            background: canSend ? 'var(--accent)' : 'var(--bg-3)',
            color: canSend ? 'var(--fg-on-accent)' : 'var(--fg-3)',
            border: 'none',
            cursor: canSend ? 'pointer' : 'default',
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
  },
);
ComposeBar.displayName = 'ComposeBar';
