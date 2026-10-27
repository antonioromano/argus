import { useState } from 'react';
import type { PromptOption } from '@argus/shared';
import { ArrowRight, MessageCircleQuestion, Send, Square, SquareCheck, Terminal } from 'lucide-react';
import { Button, Icon, TextInput } from '../../../components/primitives/index.js';

interface ChatPromptCardProps {
  /** The question on screen, when the server could read it. */
  prompt?: string;
  /** The menu's options, when the screen reliably shows them. */
  options?: PromptOption[];
  /**
   * Pick an option (`text` for a free-text one), or 'next' to leave a
   * multiSelect question: resolves with an error when the menu is gone or changed.
   */
  onAnswer: (key: string, text?: string) => Promise<string | null>;
  /** Press Esc in the session (closes a picker / dismisses a dialog). */
  onCancel: () => void;
  onShowTerminal: () => void;
}

/** An answer with no reply by then (socket dropped, server restarting) frees the buttons again. */
export const ANSWER_TIMEOUT_MS = 8000;

/**
 * What Claude Code is waiting for, above the Chat composer. A menu the server
 * could read (a permission prompt, AskUserQuestion, plan approval, the
 * trust-folder prompt) shows its own options, answered through the guarded
 * `session:answer` path: a multiSelect question shows toggles plus Continue,
 * a free-text option ("Type something.") opens a field whose text is typed
 * for the user. Anything else (the /resume picker, /help…) can only be
 * handled in the terminal, so the card says so — with the question when known.
 */
export function ChatPromptCard({ prompt, options, onAnswer, onCancel, onShowTerminal }: ChatPromptCardProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The free-text option whose field is open. */
  const [typing, setTyping] = useState<string | null>(null);
  const [text, setText] = useState('');
  const answer = (key: string, typed?: string) => {
    setBusy(true);
    setError(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve('No reply from Argus — try again, or answer in the terminal'), ANSWER_TIMEOUT_MS);
    });
    void Promise.race([onAnswer(key, typed), timeout])
      .then(setError)
      .finally(() => {
        clearTimeout(timer);
        setBusy(false);
      });
  };
  const multi = !!options?.some((o) => o.checked !== undefined);
  const submitText = () => {
    if (typing && text.trim()) answer(typing, text.trim());
  };

  const renderOption = (o: PromptOption, i: number) => {
    if (multi && o.freeText) {
      // Its field needs the cursor on it, which a digit does not move: terminal only.
      return (
        <Button key={o.key} variant="ghost" size="sm" icon={Terminal} onClick={onShowTerminal}>
          {o.label} — in the terminal
        </Button>
      );
    }
    if (o.checked !== undefined) {
      return (
        <Button key={o.key} variant={o.checked ? 'primary' : 'outline'} size="sm" icon={o.checked ? SquareCheck : Square} disabled={busy} onClick={() => answer(o.key)}>
          {o.label}
        </Button>
      );
    }
    if (o.freeText) {
      return (
        <Button key={o.key} variant={typing === o.key ? 'primary' : 'outline'} size="sm" disabled={busy} onClick={() => setTyping(typing === o.key ? null : o.key)}>
          {o.key} · {o.label}
        </Button>
      );
    }
    return (
      <Button key={o.key} variant={i === 0 && !multi ? 'primary' : 'outline'} size="sm" disabled={busy} onClick={() => answer(o.key)}>
        {o.key} · {o.label}
      </Button>
    );
  };

  return (
    <div className="argus-chat-prompt" role="group" aria-label="Claude is waiting" data-testid="chat-prompt">
      <div className="argus-chat-prompt-head">
        <Icon icon={MessageCircleQuestion} size={14} aria-hidden />
        <span className="argus-chat-prompt-text">
          {prompt || (options ? 'Claude is waiting for your choice' : 'Claude Code is showing a menu in the terminal')}
        </span>
      </div>
      <div className="argus-chat-prompt-actions">
        {options ? (
          <>
            {options.map(renderOption)}
            {multi && (
              <Button variant="solid" size="sm" iconRight={ArrowRight} disabled={busy} onClick={() => answer('next')}>
                Continue
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="primary" size="sm" icon={Terminal} onClick={onShowTerminal}>Open terminal</Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>Cancel (Esc)</Button>
          </>
        )}
        {error && <span className="argus-chat-prompt-error">{error}</span>}
      </div>
      {typing && (
        <div className="argus-chat-prompt-free" data-testid="chat-prompt-free">
          <TextInput
            value={text}
            onChange={setText}
            placeholder="Type your answer"
            autoFocus
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submitText();
              } else if (e.key === 'Escape') {
                // Only the field closes: not the overlay / panel / focus view (window handler).
                e.preventDefault();
                e.stopPropagation();
                setTyping(null);
              }
            }}
          />
          <Button variant="primary" size="sm" icon={Send} disabled={busy || !text.trim()} onClick={submitText}>Send</Button>
        </div>
      )}
    </div>
  );
}
