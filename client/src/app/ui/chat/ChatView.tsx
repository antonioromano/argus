import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, SessionInfo } from '@argus/shared';
import { MessagesSquare, ArrowDown, Terminal } from 'lucide-react';
import { useChat } from '../../../hooks/useChat.js';
import { useOverlaySuppression } from '../../../hooks/useOverlaySuppression.js';
import { Button, EmptyState, Icon, LoadingState } from '../../../components/primitives/index.js';
import { ChatMessageItem } from './ChatMessageItem.js';
import { ChatComposer } from './ChatComposer.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Distance from the bottom (px) that still counts as "following" new messages. */
const STICK_THRESHOLD = 48;

interface ChatViewProps {
  session: SessionInfo;
  socket: TypedSocket;
  /** Switch this session back to the terminal (the fallback when the chat can't be read). */
  onShowTerminal: () => void;
  /** Rendered between the messages and the composer (e.g. the waiting reply buttons). */
  aboveComposer?: ReactNode;
  autoFocus?: boolean;
}

/** Hides a native terminal overlay under the chat while it is shown. */
function SuppressNativeUnder({ target }: { target: React.RefObject<HTMLDivElement | null> }) {
  useOverlaySuppression(() => {
    const r = target.current?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  }, { live: true, observe: target });
  return null;
}

/**
 * The Chat view of a Claude session (B1): the conversation read from Claude's
 * transcript, rendered as messages, with a composer that types into the pty.
 * The terminal stays mounted underneath; this only covers it.
 */
export function ChatView({ session, socket, onShowTerminal, aboveComposer, autoFocus }: ChatViewProps) {
  const chat = useChat(socket, session.id, true);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const messages = chat.messages;

  // eslint-disable-next-line react-hooks/incompatible-library -- @tanstack/react-virtual is not React-Compiler-compatible
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 6,
    getItemKey: (i) => messages[i]?.id ?? i,
  });

  // Follow new messages while the reader is at the bottom.
  useLayoutEffect(() => {
    if (!following || messages.length === 0) return;
    virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
  }, [messages.length, following, virtualizer]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD;
    if (atBottom !== following) setFollowing(atBottom);
  };

  let body: ReactNode;
  if (!chat.loaded) {
    body = <LoadingState label="Reading transcript" />;
  } else if (!chat.available) {
    body = (
      <EmptyState
        icon={MessagesSquare}
        title="Chat not available yet"
        hint="The chat is read from Claude's transcript, which appears once this session has started a conversation. The terminal always works."
        action={<Button variant="outline" size="sm" icon={Terminal} onClick={onShowTerminal}>Back to terminal</Button>}
      />
    );
  } else if (messages.length === 0) {
    body = <EmptyState icon={MessagesSquare} title="No messages yet" hint="Send a message below, or switch to the terminal." />;
  } else {
    body = (
      <div ref={scrollRef} className="argus-scroll argus-chat-scroll" onScroll={onScroll} data-testid="chat-scroll">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const m = messages[item.index];
            const prev = messages[item.index - 1];
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}
              >
                <ChatMessageItem message={m} showRole={!prev || prev.role !== m.role} />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="argus-chat" data-testid="chat-view">
      <SuppressNativeUnder target={rootRef} />
      <div className="argus-chat-main">
        {body}
        {!following && messages.length > 0 && (
          <button
            type="button"
            className="argus-chat-jump"
            onClick={() => {
              setFollowing(true);
              virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
            }}
          >
            <Icon icon={ArrowDown} size={12} aria-hidden /> Latest
          </button>
        )}
      </div>
      {aboveComposer}
      <ChatComposer
        status={session.status}
        onSubmit={(text) => socket.emit('session:chat:send', { sessionId: session.id, text })}
        permissionMode={chat.permissionMode}
        onSetMode={(mode) =>
          new Promise<boolean>((resolve) => {
            socket.emit('session:chat:setMode', { sessionId: session.id, mode }, (r) => resolve(r.ok));
          })
        }
        model={session.usage?.model}
        modelSet={chat.modelSet}
        onShowTerminal={onShowTerminal}
        autoFocus={autoFocus}
      />
    </div>
  );
}
