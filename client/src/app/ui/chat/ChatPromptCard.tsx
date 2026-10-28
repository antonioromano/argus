import { useState } from 'react';
import type { PromptOption, PromptTab } from '@argus/shared';
import { ArrowLeft, ArrowRight, Check, MessageCircleQuestion, Send, Square, SquareCheck, Terminal } from 'lucide-react';
import { Button, Icon, TextInput } from '../../../components/primitives/index.js';

interface ChatPromptCardProps {
  /** The question on screen, when the server could read it. */
  prompt?: string;
  /** The menu's options, when the screen reliably shows them. */
  options?: PromptOption[];
  /** Several questions at once (AskUserQuestion): their tabs, with Previous / Next between them. */
  tabs?: PromptTab[];
  /**
   * Pick an option (`text` for a free-text one), 'next' to leave a multiSelect
   * question or go to the next question, 'prev' to go back one: resolves with
   * an error when the menu is gone or changed.
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
/** Option labels are prose: the sans face, not the outline buttons' mono. */
const LABEL_STYLE = { fontFamily: 'var(--font-sans)', letterSpacing: 0 } as const;
/** One option per row, label at the left edge. */
const ROW_STYLE = { ...LABEL_STYLE, justifyContent: 'flex-start' } as const;

export function ChatPromptCard({ prompt, options, tabs, onAnswer, onCancel, onShowTerminal }: ChatPromptCardProps) {
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
  const chosen = options?.some((o) => o.chosen);
  const submitText = () => {
    if (typing && text.trim()) answer(typing, text.trim());
  };

  const keyed = (o: PromptOption) => (
    <>
      <span className="argus-chat-prompt-key">{o.key}</span>
      <span className="argus-chat-prompt-label">{o.label}</span>
    </>
  );

  const renderOption = (o: PromptOption, i: number) => {
    if (multi && o.freeText) {
      // Its field needs the cursor on it, which a digit does not move: terminal only.
      return (
        <Button key={o.key} variant="ghost" size="sm" full icon={Terminal} style={ROW_STYLE} onClick={onShowTerminal}>
          <span className="argus-chat-prompt-label">{o.label} — in the terminal</span>
        </Button>
      );
    }
    if (o.checked !== undefined) {
      return (
        <Button key={o.key} variant={o.checked ? 'primary' : 'outline'} size="sm" full icon={o.checked ? SquareCheck : Square} style={ROW_STYLE} disabled={busy} onClick={() => answer(o.key)}>
          <span className="argus-chat-prompt-label">{o.label}</span>
        </Button>
      );
    }
    if (o.freeText) {
      return (
        <Button key={o.key} variant={typing === o.key ? 'primary' : 'outline'} size="sm" full style={ROW_STYLE} disabled={busy} onClick={() => setTyping(typing === o.key ? null : o.key)}>
          {keyed(o)}
        </Button>
      );
    }
    return (
      <Button
        key={o.key}
        variant={(chosen ? o.chosen : i === 0 && !multi) ? 'primary' : 'outline'}
        size="sm"
        full
        iconRight={o.chosen ? Check : undefined}
        style={ROW_STYLE}
        disabled={busy}
        onClick={() => answer(o.key)}
      >
        {keyed(o)}
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
      {options && tabs && (
        <div className="argus-chat-prompt-tabs" data-testid="chat-prompt-tabs">
          <Button variant="ghost" size="sm" icon={ArrowLeft} style={LABEL_STYLE} disabled={busy} onClick={() => answer('prev')}>Previous</Button>
          <div className="argus-chat-prompt-tablist">
            {tabs.map((t) => (
              <span key={t.label} className="argus-chat-prompt-tab" data-answered={t.answered || undefined}>
                {t.answered ? <Icon icon={Check} size={12} aria-label="answered" /> : null}
                {t.label}
              </span>
            ))}
          </div>
          <Button variant="ghost" size="sm" iconRight={ArrowRight} style={LABEL_STYLE} disabled={busy} onClick={() => answer('next')}>Next</Button>
        </div>
      )}
      {options ? (
        <>
          <div className="argus-chat-prompt-options">{options.map(renderOption)}</div>
          {((multi && !tabs) || error) && (
            <div className="argus-chat-prompt-actions">
              {multi && !tabs && (
                <Button variant="solid" size="sm" iconRight={ArrowRight} style={LABEL_STYLE} disabled={busy} onClick={() => answer('next')}>
                  Continue
                </Button>
              )}
              {error && <span className="argus-chat-prompt-error">{error}</span>}
            </div>
          )}
        </>
      ) : (
        <div className="argus-chat-prompt-actions">
          <Button variant="primary" size="sm" icon={Terminal} onClick={onShowTerminal}>Open terminal</Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel (Esc)</Button>
          {error && <span className="argus-chat-prompt-error">{error}</span>}
        </div>
      )}
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
