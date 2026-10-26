import { useState } from 'react';
import type { PromptOption } from '@argus/shared';
import { MessageCircleQuestion, Terminal } from 'lucide-react';
import { Button, Icon } from '../../../components/primitives/index.js';

interface ChatPromptCardProps {
  /** The question on screen, when the server could read it. */
  prompt?: string;
  /** The menu's numbered options, when the screen reliably shows them. */
  options?: PromptOption[];
  /** Pick an option: resolves with an error when the menu is gone or changed. */
  onAnswer: (key: string) => Promise<string | null>;
  /** Press Esc in the session (closes a picker / dismisses a dialog). */
  onCancel: () => void;
  onShowTerminal: () => void;
}

/**
 * What Claude Code is waiting for, above the Chat composer. A numbered menu
 * (a permission prompt, AskUserQuestion) shows its own options, answered with
 * their digit through the guarded `session:answer` path; anything else (the
 * /resume picker, /help, /cost…) can only be handled in the terminal, so the
 * card says so instead of offering answers it cannot type.
 */
export function ChatPromptCard({ prompt, options, onAnswer, onCancel, onShowTerminal }: ChatPromptCardProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const answer = (key: string) => {
    setBusy(true);
    setError(null);
    void onAnswer(key)
      .then(setError)
      .finally(() => setBusy(false));
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
          options.map((o, i) => (
            <Button key={o.key} variant={i === 0 ? 'primary' : 'outline'} size="sm" disabled={busy} onClick={() => answer(o.key)}>
              {o.key} · {o.label}
            </Button>
          ))
        ) : (
          <>
            <Button variant="primary" size="sm" icon={Terminal} onClick={onShowTerminal}>Open terminal</Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>Cancel (Esc)</Button>
          </>
        )}
        {error && <span className="argus-chat-prompt-error">{error}</span>}
      </div>
    </div>
  );
}
