import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Socket } from 'socket.io-client';
import type { ChatBlock, ChatMessage, ClientToServerEvents, ServerToClientEvents, SessionInfo } from '@argus/shared';
import { MessagesSquare, ArrowDown, Terminal } from 'lucide-react';
import { useChat } from '../../../hooks/useChat.js';
import { api } from '../../../services/api.js';
import { useOverlaySuppression } from '../../../hooks/useOverlaySuppression.js';
import { Button, EmptyState, Icon, LoadingState } from '../../../components/primitives/index.js';
import { ChatMessageItem } from './ChatMessageItem.js';
import { ChatComposer } from './ChatComposer.js';
import { ChatPromptCard } from './ChatPromptCard.js';
import { ChatResumePicker } from './ChatResumePicker.js';
import type { ToolOpenState } from './ChatToolGroup.js';
import { chatRows } from './toolSteps.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Distance from the bottom (px) that still counts as "following" new messages. */
const STICK_THRESHOLD = 48;
/** A stop that hasn't ended the turn by then gives the Stop button back. */
const STOP_RETRY_MS = 8000;

/**
 * A prompt sent from the composer, shown until the transcript records it.
 * `at` is the user message it will become (their count when it lands).
 */
interface Pending {
  id: string;
  blocks: ChatBlock[];
  at: number;
  /** Stop was pressed while it was still unrecorded. */
  stopped?: boolean;
}
/** Matches the notice ChatTail makes of Claude Code's "[Request interrupted by user]". */
const STOPPED_MARK: ChatBlock = { kind: 'notice', text: 'Stopped' };
const STOPPED_NOTICE: ChatBlock = { kind: 'notice', text: 'Stopped before Claude recorded it — it is not in the conversation.' };
let pendingSeq = 0;
/** The Chat view used last: ⌘Esc goes to it while focus is on no element. */
let lastChat: HTMLElement | null = null;
/** A slash command as the server echoes it (ChatTail.echoCommandOf): `/name`, then a space or the end. */
const SLASH_COMMAND_RE = /^\/[^\s/]+(?:\s|$)/;

interface ChatViewProps {
  session: SessionInfo;
  socket: TypedSocket;
  /** Switch this session back to the terminal (the fallback when the chat can't be read). */
  onShowTerminal: () => void;
  /** Rendered between the messages and the composer. */
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
  // `/resume` alone opens the Chat's own picker instead of Claude Code's terminal one.
  const [resumeOpen, setResumeOpen] = useState(false);
  const send = (text: string) => socket.emit('session:chat:send', { sessionId: session.id, text });
  const [pending, setPending] = useState<Pending[]>([]);
  /** The recorded prompt whose turn Stop ended (marked unless Claude Code marks it itself). */
  const [stoppedId, setStoppedId] = useState<string | null>(null);
  const userCount = useMemo(() => chat.messages.filter((m) => m.role === 'user').length, [chat.messages]);
  const [stopAsked, setStopAsked] = useState(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const running = session.status === 'running';
  const stopping = stopAsked && running;
  // Esc in the pty is how Claude Code interrupts a turn.
  const stop = () => {
    if (stopping) return;
    socket.emit('session:input', { sessionId: session.id, data: '\x1b' });
    setStopAsked(true);
    setPending((cur) => cur.map((p) => ({ ...p, stopped: true })));
    const lastUser = chat.messages.findLast((m) => m.role === 'user');
    setStoppedId(pending.some((p) => p.at > userCount) ? null : (lastUser?.id ?? null));
    clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => setStopAsked(false), STOP_RETRY_MS);
  };
  useEffect(() => () => clearTimeout(stopTimer.current), []);
  const onStopKey = useRef<() => void>(undefined);
  onStopKey.current = () => {
    if (running) stop();
  };
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const mark = () => { lastChat = root; };
    // ⌘Esc stops the turn while this view has focus, or while nothing does
    // (a clicked Stop button disables itself and drops focus to the body).
    // Window capture, so the window's Escape handler, which ignores modifiers
    // and would also leave focus mode, never sees it; plain Esc is untouched.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !e.metaKey || e.isComposing) return;
      const at = document.activeElement;
      const idle = !at || at === document.body;
      const inside = root.contains(e.target as Node | null) || root.contains(at);
      if (!inside && !(idle && lastChat === root)) return;
      e.preventDefault();
      e.stopPropagation();
      onStopKey.current?.();
    };
    root.addEventListener('pointerdown', mark);
    root.addEventListener('focusin', mark);
    window.addEventListener('keydown', onKey, true);
    return () => {
      root.removeEventListener('pointerdown', mark);
      root.removeEventListener('focusin', mark);
      window.removeEventListener('keydown', onKey, true);
      if (lastChat === root) lastChat = null;
    };
  }, []);
  useEffect(() => {
    // The turn ended: the next Stop starts fresh.
    if (!running) setStopAsked(false);
  }, [running]);

  // A prompt drops out once the transcript holds that many user messages.
  const shown = useMemo(() => pending.filter((p) => p.at > userCount), [pending, userCount]);
  useEffect(() => {
    // Prune what the transcript has caught up with.
    if (shown.length !== pending.length) setPending(shown);
  }, [shown, pending.length]);
  const recorded = useMemo(() => {
    const i = stoppedId && !stopping ? chat.messages.findIndex((m) => m.id === stoppedId) : -1;
    if (i < 0) return chat.messages;
    // Stopped mid-reply, Claude Code records its own "Stopped"; a reply with no
    // marker means the turn had already ended and Stop had nothing to stop.
    if (chat.messages.slice(i + 1).some((m) => m.role === 'assistant' || m.role === 'system')) return chat.messages;
    const out = chat.messages.slice();
    out[i] = { ...out[i], blocks: [...out[i].blocks, STOPPED_MARK] };
    return out;
  }, [chat.messages, stoppedId, stopping]);
  const messages = useMemo<ChatMessage[]>(
    () =>
      shown.length === 0
        ? recorded
        : recorded.concat(
            shown.map((p) => ({ id: p.id, role: 'user', blocks: p.stopped && !stopping ? [...p.blocks, STOPPED_NOTICE] : p.blocks })),
          ),
    [recorded, shown, stopping],
  );
  const pendingIds = new Set(shown.map((p) => p.id));
  // Runs of tool calls fold into one row (F7).
  const rows = useMemo(() => chatRows(messages), [messages]);
  const [toolStore] = useState<ToolOpenState>(() => new Set());
  /**
   * Show a plain prompt at once; a slash command gets its echo from the server.
   * (A message can start with an attachment's path: `/var/…` is no command.)
   */
  const echo = (text: string, preview: ChatBlock[]) => {
    if (preview.length === 0 || SLASH_COMMAND_RE.test(text.trim()) || session.status === 'waiting') return;
    setPending((cur) => [...cur, { id: `pending-${++pendingSeq}`, blocks: preview, at: userCount + cur.length + 1 }]);
    setFollowing(true);
  };

  // eslint-disable-next-line react-hooks/incompatible-library -- @tanstack/react-virtual is not React-Compiler-compatible
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 6,
    getItemKey: (i) => rows[i]?.id ?? i,
  });

  // Follow new messages while the reader is at the bottom.
  useLayoutEffect(() => {
    if (!following || rows.length === 0) return;
    virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
    // `messages`, not a count: a call can join the last row, or a result grow it, with no new row.
  }, [messages, rows.length, following, virtualizer]);

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
            const m = rows[item.index];
            const prev = rows[item.index - 1];
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}
              >
                <ChatMessageItem message={m} showRole={!prev || prev.role !== m.role} pending={pendingIds.has(m.id)} toolStore={toolStore} />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="argus-chat"
      data-testid="chat-view"
    >
      <SuppressNativeUnder target={rootRef} />
      <div className="argus-chat-main">
        {body}
        {!following && messages.length > 0 && (
          <button
            type="button"
            className="argus-chat-jump"
            onClick={() => {
              setFollowing(true);
              virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
            }}
          >
            <Icon icon={ArrowDown} size={12} aria-hidden /> Latest
          </button>
        )}
      </div>
      {resumeOpen && (
        <div className="argus-chat-prompt-wrap">
          <ChatResumePicker
            load={() => api.listConversations(session.id)}
            onPick={(id) => {
              setResumeOpen(false);
              send(`/resume ${id}`);
            }}
            onUseTerminal={() => {
              setResumeOpen(false);
              send('/resume');
              onShowTerminal();
            }}
            onClose={() => setResumeOpen(false)}
          />
        </div>
      )}
      {session.status === 'waiting' && (
        <div className="argus-chat-prompt-wrap">
          <ChatPromptCard
            // A new menu (other options) starts with no stale error.
            key={JSON.stringify(session.promptOptions ?? null)}
            prompt={session.lastPrompt}
            options={session.promptOptions}
            onAnswer={(key) =>
              new Promise<string | null>((resolve) => {
                socket.emit('session:answer', { sessionId: session.id, key }, (r) => resolve(r.ok ? null : r.error));
              })
            }
            onCancel={() => socket.emit('session:input', { sessionId: session.id, data: '\x1b' })}
            onShowTerminal={onShowTerminal}
          />
        </div>
      )}
      {aboveComposer}
      <ChatComposer
        status={session.status}
        onStop={stop}
        stopping={stopping}
        onSubmit={(text, preview) => {
          if (text.trim() === '/resume') setResumeOpen(true);
          else {
            echo(text, preview);
            send(text);
          }
        }}
        permissionMode={chat.permissionMode}
        onSetMode={(mode) =>
          new Promise<boolean>((resolve) => {
            socket.emit('session:chat:setMode', { sessionId: session.id, mode }, (r) => resolve(r.ok));
          })
        }
        model={session.usage?.model}
        modelSet={chat.modelSet}
        commands={chat.commands}
        onUploadImage={(file) => api.uploadChatImage(session.id, file)}
        onShowTerminal={onShowTerminal}
        autoFocus={autoFocus}
      />
    </div>
  );
}
