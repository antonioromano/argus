import { useEffect, useRef, useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import type { SessionStatus } from '@argus/shared';
import { IconButton } from '../../../components/primitives/index.js';
import { CHAT_ENTER_DELAY_MS, chatInputBytes } from '../../../utils/chat.js';

interface ChatComposerProps {
  status: SessionStatus;
  /** Raw pty input, same path as ReplyBar and the terminal. */
  onSend: (data: string) => void;
  autoFocus?: boolean;
}

/**
 * The Chat view's prompt box. Text goes to the agent through the pty, exactly
 * as if typed in the terminal: the text first, then Enter as a separate write.
 * Enter sends, Shift+Enter adds a line.
 */
export function ChatComposer({ status, onSend, autoFocus }: ChatComposerProps) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const exited = status === 'exited';

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useEffect(() => () => clearTimeout(enterTimer.current), []);

  const send = () => {
    if (exited || !text.trim()) return;
    onSend(chatInputBytes(text));
    enterTimer.current = setTimeout(() => onSend('\r'), CHAT_ENTER_DELAY_MS);
    setText('');
  };

  return (
    <div className="argus-chat-composer">
      <textarea
        ref={ref}
        value={text}
        rows={Math.min(8, Math.max(1, text.split('\n').length))}
        disabled={exited}
        placeholder={exited ? 'Session has exited — restart it to continue.' : 'Message Claude…  (Enter to send, Shift+Enter for a new line)'}
        aria-label="Message"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <IconButton icon={SendHorizontal} label="Send" size="sm" onClick={send} disabled={exited || !text.trim()} />
    </div>
  );
}
