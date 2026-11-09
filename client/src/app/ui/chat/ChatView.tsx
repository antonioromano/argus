import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Socket } from 'socket.io-client';
import type { AgentRun, ChatBlock, ChatMessage, ChatQueuedPrompt, ClientToServerEvents, ServerToClientEvents, SessionInfo } from '@argus/shared';
import { MessagesSquare, ArrowDown, SquareTerminal, X } from 'lucide-react';
import { useChat } from '../../../hooks/useChat.js';
import { api } from '../../../services/api.js';
import { useOverlaySuppression } from '../../../hooks/useOverlaySuppression.js';
import { Button, EmptyState, Icon, LoadingState } from '../../../components/primitives/index.js';
import { interactiveCommandOf, slashCommandName } from '../../../utils/chat.js';
import { ChatMessageItem } from './ChatMessageItem.js';
import { ChatAgentsStrip } from './ChatAgentsStrip.js';
import { ChatComposer } from './ChatComposer.js';
import { ChatPromptCard } from './ChatPromptCard.js';
import { ChatResumePicker } from './ChatResumePicker.js';
import type { ToolOpenState } from './ChatToolGroup.js';
import { chatRows } from './toolSteps.js';
import { showTypingRow } from './typingRow.js';
import { AgentOpenContext, type AgentOpener } from './agentOpen.js';
import { launchPending, newPending, openPending, userCountOf, type Pending } from './pendingEchoes.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Distance from the bottom (px) that still counts as "following" new messages. */
const STICK_THRESHOLD = 48;
/** A stop that hasn't ended the turn by then gives the Stop button back. */
const STOP_RETRY_MS = 8000;
/** Matches the notice ChatTail makes of Claude Code's "[Request interrupted by user]". */
const STOPPED_MARK: ChatBlock = { kind: 'notice', text: 'Stopped' };
const STOPPED_NOTICE: ChatBlock = { kind: 'notice', text: 'Stopped before Claude recorded it — it is not in the conversation.' };
const ENDED_NOTICE: ChatBlock = { kind: 'notice', text: 'The session ended before Claude recorded it — it is not in the conversation.' };
/** Ctrl+X Ctrl+S: Claude Code's "send now" for its queue (verified on 2.1.316). */
const SEND_NOW_KEY = '\x18\x13';
const NO_QUEUE: ChatQueuedPrompt[] = [];
const NO_AGENTS: AgentRun[] = [];
let pendingSeq = 0;
/** The Chat view used last: ⌘Esc goes to it while focus is on no element. */
let lastChat: HTMLElement | null = null;
/** Height of the terminal sheet's bar; the host insets the terminal by it so the bar never covers it. */
export const TERMINAL_SHEET_BAR_PX = 36;

interface ChatViewProps {
  session: SessionInfo;
  socket: TypedSocket;
  /** Switch this session back to the terminal (the fallback when the chat can't be read). */
  onShowTerminal: () => void;
  /** Rendered between the messages and the composer. */
  aboveComposer?: ReactNode;
  autoFocus?: boolean;
  /**
   * The terminal sheet (F6) opened or closed. While it is open the Chat is see-through below
   * its bar: the host insets the terminal by TERMINAL_SHEET_BAR_PX and gives it the keyboard.
   */
  onTerminalSheet?: (open: boolean) => void;
  /** A row of the agents strip was tapped. Without it the rows show but do nothing. */
  onOpenAgent?: (agent: AgentRun) => void;
}

/**
 * A one-shot request typed into the pty (Stop, Send now): on until `active`
 * (Claude running) ends or `retryMs` passes, so it can be asked again.
 */
function useRequest(active: boolean, retryMs: number) {
  const [asked, setAsked] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // The turn ended: the next one starts fresh.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) setAsked(false);
  }
  const ask = () => {
    setAsked(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAsked(false), retryMs);
  };
  return { on: asked && active, ask, reset: () => setAsked(false) };
}

/** The id of the last recorded user message. */
function lastUserId(messages: ChatMessage[]): string | null {
  return messages.findLast((m) => m.role === 'user' && !m.echo)?.id ?? null;
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
export function ChatView({ session, socket, onShowTerminal, aboveComposer, autoFocus, onTerminalSheet, onOpenAgent }: ChatViewProps) {
  const chat = useChat(socket, session.id, true);
  const openAgent = (agent: AgentRun) => onOpenAgent?.(agent);
  const onOpenAgentRef = useRef(onOpenAgent);
  onOpenAgentRef.current = onOpenAgent;
  const canOpenAgent = onOpenAgent !== undefined;
  const roster = session.agents ?? NO_AGENTS;
  // Agent steps offer "Open" for agents in the roster (only when the host can show one).
  const agentOpener = useMemo<AgentOpener | null>(() => {
    if (!canOpenAgent) return null;
    const byToolUse = new Map(roster.filter((a) => a.toolUseId).map((a) => [a.toolUseId!, a]));
    return { agentFor: (id) => byToolUse.get(id), open: (a) => onOpenAgentRef.current?.(a) };
  }, [canOpenAgent, roster]);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  // `/resume` alone opens the Chat's own picker instead of Claude Code's terminal one.
  const [resumeOpen, setResumeOpen] = useState(false);
  const send = (text: string) => socket.emit('session:chat:send', { sessionId: session.id, text });
  // An interactive command (`/mcp`, `/config`, …) runs in the terminal, shown through a sheet.
  const [sheet, setSheet] = useState<string | null>(null);
  /** Sent during a turn: Claude Code runs it once the turn ends, and the sheet opens then. */
  const [queuedSheet, setQueuedSheet] = useState<string | null>(null);
  /**
   * Which settled screens tell how the command went: those after `from` (chat.screen.seq).
   * A queued command closes the sheet only after its picker was seen (`left`): the turn's
   * own last screen can still show the empty box before Claude Code runs it.
   */
  const sheetTrack = useRef({ from: 0, needsLeave: false, left: false });
  const openSheet = (name: string, queued: boolean) => {
    sheetTrack.current = { from: chat.screen?.seq ?? 0, needsLeave: queued, left: false };
    setSheet(name);
  };
  const [pending, setPending] = useState<Pending[]>([]);
  /** The recorded prompt whose turn Stop ended (marked unless Claude Code marks it itself). */
  const [stoppedId, setStoppedId] = useState<string | null>(null);
  const running = session.status === 'running';
  const stopRequest = useRequest(running, STOP_RETRY_MS);
  const stopping = stopRequest.on;
  // Esc in the pty is how Claude Code interrupts a turn.
  const stop = () => {
    if (stopping) return;
    socket.emit('session:input', { sessionId: session.id, data: '\x1b' });
    stopRequest.ask();
    // Esc also sends Claude Code's queue on (verified on 2.1.316): only a prompt
    // sent at its prompt can be stopped before it is recorded.
    setPending((cur) => cur.map((p) => (p.stopped || p.queueAt !== undefined ? p : { ...p, stopped: true })));
    // Such a prompt is the turn's own; otherwise the last recorded one is.
    setStoppedId(shown.some((p) => p.queueAt === undefined) ? null : lastUserId(chat.messages));
  };
  /**
   * "Send now" on a queued prompt: Claude Code's own send-now key interrupts the
   * step and submits its whole queue in order, each prompt once. Nothing is typed
   * again; with an empty queue (already read) the key does nothing.
   */
  const sendNowRequest = useRequest(running, STOP_RETRY_MS);
  const sendingNow = sendNowRequest.on;
  const sendNow = () => {
    if (!running || stopping || sendingNow) return;
    socket.emit('session:input', { sessionId: session.id, data: SEND_NOW_KEY });
    sendNowRequest.ask();
  };
  const sendNowRef = useRef(sendNow);
  sendNowRef.current = sendNow;
  const onSendNow = useCallback(() => sendNowRef.current(), []);
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

  const status = session.status;
  useEffect(() => {
    if (!queuedSheet) return;
    if (status === 'exited') {
      setQueuedSheet(null);
      return;
    }
    // Only the turn's end runs it: a permission prompt mid-turn (`waiting`) is no picker of ours.
    if (status !== 'idle') return;
    setQueuedSheet(null);
    openSheet(queuedSheet, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openSheet reads the screen seq now
  }, [queuedSheet, status]);
  const screen = chat.screen;
  useEffect(() => {
    if (!sheet) return;
    if (status === 'exited') {
      setSheet(null);
      return;
    }
    // Read from the screen, not the status: many pickers (/config, /hooks) never read as
    // `waiting`. The first settle after the command that shows Claude's empty input box again
    // closes it: the picker was left (Esc, a pick), or the command opened none. A picker, a
    // nested view, a flow at work or the command still typed in the box keep it open. There is
    // no Esc shortcut: in a nested picker Esc only goes back a level.
    const track = sheetTrack.current;
    if (!screen || screen.seq <= track.from) return;
    if (!screen.atPrompt) track.left = true;
    else if (!track.needsLeave || track.left) setSheet(null);
  }, [sheet, status, screen]);
  const onSheetRef = useRef(onTerminalSheet);
  onSheetRef.current = onTerminalSheet;
  const sheetOpen = sheet !== null;
  useEffect(() => {
    if (!sheetOpen) return;
    onSheetRef.current?.(true);
    return () => onSheetRef.current?.(false);
  }, [sheetOpen]);

  const userCount = useMemo(() => userCountOf(chat.messages), [chat.messages]);
  const queueSeq = chat.queue?.seq ?? 0;
  // The prompt the session was started with shows at once, like one sent from the composer (F15).
  // The server holds it only until the first turn ends (F15b), so every mount, in every window,
  // seeds it while it is there and nothing is recorded; once seeded, the echo stays until the
  // transcript records it, even if the server drops the prompt first.
  const launchPrompt = session.initialPrompt;
  const launchSeeded = useRef(false);
  useEffect(() => {
    if (!chat.loaded || !launchPrompt || launchSeeded.current) return;
    // A command gets its echo from the server, as when typed in the composer.
    if (slashCommandName(launchPrompt.text) !== null) return;
    launchSeeded.current = true;
    const p = launchPending(`pending-${++pendingSeq}`, launchPrompt, userCount);
    if (p) setPending((cur) => [p, ...cur]);
  }, [chat.loaded, userCount, launchPrompt]);
  const exited = session.status === 'exited';
  // A prompt drops out once the transcript records it or Claude Code queues it.
  const shown = useMemo(() => openPending(pending, userCount, queueSeq), [pending, userCount, queueSeq]);
  // F15b: the transcript is unreadable once a turn ended (running → idle/done) while a prompt
  // was still unrecorded and no transcript was found, and the server no longer calls the session
  // starting. Seen by this mount only: a restored session has no startup info on the server.
  const [unreadable, setUnreadable] = useState(false);
  const prevStatus = useRef(session.status);
  const hasShown = shown.length > 0;
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = status;
    if (prev === 'running' && (status === 'idle' || status === 'done') && hasShown && chat.loaded && !chat.available) setUnreadable(true);
  }, [status, hasShown, chat.loaded, chat.available]);
  useEffect(() => {
    // Prune what the transcript has caught up with.
    if (shown !== pending) setPending(shown);
  }, [shown, pending]);
  // Claude Code holds a queue only while it works (at its prompt it reads it at
  // once), so one left over from an earlier run is not shown.
  const busy = running || session.status === 'waiting';
  const queue = busy ? (chat.queue?.items ?? NO_QUEUE) : NO_QUEUE;
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
  // Claude Code's queue, then what was just sent and is not recorded or queued yet.
  const messages = useMemo<ChatMessage[]>(
    () =>
      queue.length === 0 && shown.length === 0
        ? recorded
        : recorded.concat(
            queue.map((q) => ({ id: q.id, role: 'user', blocks: q.blocks })),
            shown.map((p) => ({
              id: p.id,
              role: 'user',
              // Ended unrecorded (a failed start, an exit): Claude will not record it now.
              blocks: p.stopped && !stopping ? [...p.blocks, STOPPED_NOTICE] : exited ? [...p.blocks, ENDED_NOTICE] : p.blocks,
            })),
          ),
    [recorded, queue, shown, stopping, exited],
  );
  const { pendingIds, queuedIds } = useMemo(() => {
    const queued = busy ? queue.map((q) => q.id).concat(shown.filter((p) => p.queueAt !== undefined).map((p) => p.id)) : [];
    return { pendingIds: new Set([...queue.map((q) => q.id), ...shown.map((p) => p.id)]), queuedIds: new Set(queued) };
  }, [busy, queue, shown]);
  // Runs of tool calls fold into one row (F7).
  const rows = useMemo(() => chatRows(messages), [messages]);
  const [toolStore] = useState<ToolOpenState>(() => new Set());
  const hasQueued = queuedIds.size > 0;
  const resetSendNow = sendNowRequest.reset;
  useEffect(() => {
    // Claude read the queue: a prompt queued after it gets a fresh "Send now".
    if (!hasQueued) resetSendNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset is a fresh closure each render
  }, [hasQueued]);
  // Only mid-step: at Claude's prompt the queue goes out by itself.
  const canSendNow = running && !stopping;
  /**
   * Show a plain prompt at once; a slash command gets its echo from the server.
   * (A message can start with an attachment's path: `/var/…` is no command.)
   */
  const echo = (text: string, preview: ChatBlock[]) => {
    if (preview.length === 0 || slashCommandName(text) !== null || session.status === 'waiting') return;
    const id = `pending-${++pendingSeq}`;
    setPending((cur) => [...cur, newPending(id, preview, cur, userCount, queue.length, chat.queue, running)]);
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
  } else if (!chat.available && messages.length === 0) {
    body = (
      <EmptyState
        icon={MessagesSquare}
        title="Chat not available yet"
        hint="The chat is read from Claude's transcript, which appears once this session has started a conversation. The terminal always works."
        action={<Button variant="outline" size="sm" icon={SquareTerminal} onClick={onShowTerminal}>Back to terminal</Button>}
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
                <ChatMessageItem
                  message={m}
                  showRole={!prev || prev.role !== m.role}
                  pending={pendingIds.has(m.id)}
                  queued={queuedIds.has(m.id)}
                  onSendNow={canSendNow && queuedIds.has(m.id) ? onSendNow : undefined}
                  sendingNow={sendingNow && queuedIds.has(m.id)}
                  toolStore={toolStore}
                />
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
      data-sheet={sheetOpen || undefined}
    >
      {/* The sheet's bar sits above the inset terminal, so nothing of the Chat covers it then. */}
      {!sheetOpen && <SuppressNativeUnder target={rootRef} />}
      {sheet && (
        <div className="argus-chat-sheet-bar" style={{ height: TERMINAL_SHEET_BAR_PX }} data-testid="chat-terminal-sheet">
          <Icon icon={SquareTerminal} size="md" aria-hidden />
          <span className="argus-chat-sheet-title">
            <code>/{sheet}</code> runs in the terminal
          </span>
          <span className="argus-chat-sheet-hint">Close it when you are done</span>
          <Button variant="ghost" size="sm" onClick={() => { setSheet(null); onShowTerminal(); }}>
            Open terminal
          </Button>
          {/* Text, not a tooltip-ed icon: a tooltip over a native terminal would hide it. */}
          <Button variant="ghost" size="sm" icon={X} onClick={() => setSheet(null)}>
            Close
          </Button>
        </div>
      )}
      <div className="argus-chat-main">
        <AgentOpenContext.Provider value={agentOpener}>{body}</AgentOpenContext.Provider>
        {showTypingRow(session.status, session.agentsRunning ?? 0, rows[rows.length - 1]) && (
          <div className="argus-chat-typing" data-testid="chat-typing">Claude is writing…</div>
        )}
        {!chat.available && messages.length > 0 && (
          // Prompts sent before Claude wrote its transcript (F15): shown at once, with the terminal at hand.
          <div className="argus-chat-starting" data-testid="chat-starting">
            <span>
              {exited
                ? 'The session ended before Claude started the conversation.'
                : session.starting || !unreadable
                  ? 'Starting Claude…'
                  // A turn ended with no transcript found (F15b): it is not coming.
                  : "Chat can't read this session's transcript — use the terminal"}
            </span>
            <Button variant="ghost" size="sm" icon={SquareTerminal} onClick={onShowTerminal}>Terminal</Button>
          </div>
        )}
        {!following && messages.length > 0 && (
          <button
            type="button"
            className="argus-chat-jump"
            onClick={() => {
              setFollowing(true);
              virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
            }}
          >
            <Icon icon={ArrowDown} size="sm" aria-hidden /> Latest
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
            // A new menu (other options, another question) starts with no stale error.
            key={JSON.stringify([session.promptOptions ?? null, session.promptQuestion ?? null])}
            prompt={session.promptQuestion ?? session.lastPrompt}
            options={session.promptOptions}
            tabs={session.promptTabs}
            onAnswer={(key, text) =>
              new Promise<string | null>((resolve) => {
                const payload = text === undefined ? { sessionId: session.id, key } : { sessionId: session.id, key, text };
                socket.emit('session:answer', payload, (r) => resolve(r.ok ? null : r.error));
              })
            }
            onCancel={() => socket.emit('session:input', { sessionId: session.id, data: '\x1b' })}
            onShowTerminal={onShowTerminal}
          />
        </div>
      )}
      <ChatAgentsStrip agents={roster} onOpen={openAgent} />
      {aboveComposer}
      <ChatComposer
        sessionId={session.id}
        status={session.status}
        onStop={stop}
        stopping={stopping}
        onSubmit={(text, preview) => {
          if (text.trim() === '/resume') setResumeOpen(true);
          else {
            // Typed into a waiting prompt it is an answer, not a command.
            const interactive = session.status === 'waiting' ? null : interactiveCommandOf(text);
            if (interactive && running) setQueuedSheet(interactive);
            else if (interactive) openSheet(interactive, false);
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
        suggestion={chat.suggestion}
        onUploadImage={(file) => api.uploadChatImage(session.id, file)}
        onShowTerminal={onShowTerminal}
        // Back from the sheet, the composer takes the keyboard again.
        autoFocus={autoFocus && !sheetOpen}
      />
    </div>
  );
}
