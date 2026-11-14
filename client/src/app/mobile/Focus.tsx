import { useEffect, useRef, useState } from 'react';
import { Keyboard, MessagesSquare } from 'lucide-react';
import type { SessionInfo, SessionViewMode } from '@argus/shared';
import { useSocket } from '../../hooks/useSocket.js';
import { useTerminal } from '../../hooks/useTerminal.js';
import { useTheme } from '../../context/theme-context.js';
import { supportsChatView } from '../../utils/chat.js';
import { ChatView, TERMINAL_SHEET_BAR_PX } from '../ui/chat/ChatView.js';
import { ChatAgentSheet } from '../ui/chat/ChatAgentSheet.js';
import { useOpenedAgent } from '../../hooks/useAgentChat.js';
import { FocusHeader } from './FocusHeader.js';
import { FocusTerminal } from './FocusTerminal.js';
import { Diff } from './Diff.js';
import { MobileKeyboard } from './keyboard/MobileKeyboard.js';
import { Button, Icon } from '../../components/primitives/index.js';

interface FocusProps {
  session: SessionInfo;
  /** Terminal or Chat for this session: the stored per-session choice, else the
   *  caller's default (MobileApp passes chat). Null only when a caller has no
   *  default yet: the body is then covered rather than flashing a view. */
  viewMode: SessionViewMode | null;
  onSetViewMode: (mode: SessionViewMode) => void;
  onBack: () => void;
  onActions: () => void;
}

export function Focus({ session, viewMode, onSetViewMode, onBack, onActions }: FocusProps) {
  const socket = useSocket();
  const [showChanges, setShowChanges] = useState(false);
  const [openAgent, setOpenAgent] = useOpenedAgent(session);
  // An interactive command sent from the chat (`/usage`, `/config`, …) draws its dialog in
  // the terminal, which the chat can't render. A phone has no room for the desktop's
  // see-through sheet, so the terminal takes the screen while the command runs, and the
  // chat comes back once its dialog closes. The chat stays mounted (hidden) meanwhile: it
  // is what sees the input box return. The stored Terminal/Chat choice is left alone.
  const [command, setCommand] = useState<string | null>(null);
  const [closeRequest, setCloseRequest] = useState(0);

  // Chat is Claude only, chosen per session (same key as the desktop); on the
  // phone the default is chat (MobileApp). A null mode means no default is
  // known: cover the body rather than flash one view and swap a moment later.
  const chatCapable = supportsChatView(session.agentType);
  const chatMode = chatCapable && viewMode === 'chat';
  const commandTerminal = chatMode && command !== null;
  const viewPending = chatCapable && viewMode === null;

  // Lock the container to a fixed pixel height derived from visualViewport.height.
  //
  // Why not `100dvh`: iOS Safari animates dvh as its toolbar shows/hides during
  // scroll. That CSS change triggers the ResizeObserver on the terminal container →
  // fitAddon.fit() mid-gesture → xterm re-layout → jumpy/stalling scroll.
  //
  // Fix: always use vv.height as a fixed pixel value. Debounce updates by 150ms so
  // the toolbar animation (which fires many events over ~300ms) only causes ONE
  // refit after it settles, never mid-gesture. The chat rides the same height so
  // its composer stays above the software keyboard.
  const vv0 = window.visualViewport;
  const [vvHeight, setVvHeight] = useState<number>(
    vv0 ? Math.round(vv0.height) : window.innerHeight,
  );
  const vvHeightRef = useRef<number>(vvHeight);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = Math.round(vv.height);
        if (next !== vvHeightRef.current) {
          vvHeightRef.current = next;
          setVvHeight(next);
          window.dispatchEvent(new Event('terminal:refit'));
        }
      }, 150);
    };
    vv.addEventListener('resize', onChange);
    vv.addEventListener('scroll', onChange);
    return () => {
      vv.removeEventListener('resize', onChange);
      vv.removeEventListener('scroll', onChange);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: `${vvHeight}px`,
        background: 'var(--bg-inset)',
        overflow: 'hidden',
      }}
    >
      <FocusHeader session={session} onBack={onBack} onActions={onActions} onShowChanges={() => setShowChanges(true)} />
      {chatMode ? (
        // The body below the header: the hidden chat is sized against it, so it keeps
        // the height (and scroll position) it has when shown.
        <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {commandTerminal && (
            <>
              <div
                data-testid="command-terminal-bar"
                className="argus-chat-sheet-bar"
                style={{ height: TERMINAL_SHEET_BAR_PX }}
              >
                <span className="argus-chat-sheet-title">
                  <code>/{command}</code> runs in the terminal
                </span>
                <span className="argus-chat-sheet-hint" />
                <Button
                  variant="ghost"
                  size="sm"
                  icon={MessagesSquare}
                  onClick={() => {
                    setCommand(null);
                    setCloseRequest((n) => n + 1);
                  }}
                >
                  Back to chat
                </Button>
              </div>
              <TerminalMode key={`command-${session.id}`} session={session} />
            </>
          )}
          {/* Keyed so a session switch never reuses the other session's chat state. */}
          {/* Hidden by visibility, never display: none, which would drop its layout box and
              with it the scroll offset: the chat comes back where the reader left it. */}
          <div
            key={`chat-${session.id}`}
            className="mobile-chat"
            aria-hidden={commandTerminal || undefined}
            style={
              commandTerminal
                ? { position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none' }
                : { position: 'relative', flex: 1, minHeight: 0 }
            }
          >
            <ChatView
              session={session}
              socket={socket}
              onShowTerminal={() => onSetViewMode('terminal')}
              onTerminalSheet={(open, name) => setCommand(open ? (name ?? '') : null)}
              sheetCloseRequest={closeRequest}
              onOpenAgent={setOpenAgent}
            />
          </div>
        </div>
      ) : viewPending ? (
        <div data-testid="view-pending" aria-hidden style={{ flex: 1, minHeight: 0, background: 'var(--bg-inset)' }} />
      ) : (
        <TerminalMode key={session.id} session={session} />
      )}
      {/* Full screen over the chat, like Changes: a phone has no room for a sheet beside it. */}
      {chatMode && openAgent && (
        <ChatAgentSheet session={session} agent={openAgent} onClose={() => setOpenAgent(null)} fullScreen />
      )}
      {showChanges && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-sheet)' }}>
          <Diff session={session} onBack={() => setShowChanges(false)} />
        </div>
      )}
    </div>
  );
}

/**
 * The terminal with its input surface. Mounted only while the session shows as
 * a terminal: a phone in the room sizes the pty to itself (the server fits the
 * smallest mobile viewer), which a phone reading the chat must not do.
 */
function TerminalMode({ session }: { session: SessionInfo }) {
  const socket = useSocket();
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(true);

  // The input surface changes height when shown/hidden — refit the terminal.
  useEffect(() => { window.dispatchEvent(new Event('terminal:refit')); }, [keyboardOpen]);

  // This component owns the terminal lifecycle so the on-screen keyboard can
  // share the handle (DECCKM-aware arrows, local viewport scrolling).
  const { terminalRef } = useTerminal(containerRef, {
    sessionId: session.id,
    socket,
    theme,
    readOnly: true,
  });

  // Landscape on a phone leaves ~380px of height. With the input surface docked
  // that left the terminal 8 rows (measured, iPhone 15 Pro over the tunnel) — and
  // since the server fits the pty to the smallest mobile viewer, those 8 rows
  // became everyone's pty height. Collapse the surface to its restore strip on
  // rotation into landscape and give the rows back to the terminal; reopening is
  // one tap, and rotating back restores what we closed.
  //
  // Keyed off orientation, NOT height: the software keyboard also shrinks
  // visualViewport.height, and collapsing the surface then would fight the very
  // keyboard the user just raised.
  const [landscape, setLandscape] = useState(
    () => window.matchMedia?.('(orientation: landscape)').matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(orientation: landscape)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setLandscape(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const autoClosedRef = useRef(false);
  useEffect(() => {
    if (landscape) {
      setKeyboardOpen((open) => {
        if (open) autoClosedRef.current = true;
        return false;
      });
    } else if (autoClosedRef.current) {
      autoClosedRef.current = false;
      setKeyboardOpen(true);
    }
  }, [landscape]);

  // On-device debug overlay: visit /mobile?debug=1 to activate.
  // Shows live terminal buffer stats so scroll issues can be diagnosed without
  // Safari Web Inspector or a cable.
  const debugMode = typeof window !== 'undefined' && window.location.search.includes('debug=1');
  const [debugStats, setDebugStats] = useState('');

  useEffect(() => {
    if (!debugMode) return;
    const tick = () => {
      const t = terminalRef.current;
      if (!t) return;
      const buf = t.buffer.active;
      const screenEl = containerRef.current?.querySelector<HTMLElement>('.xterm-screen');
      const screenH = screenEl ? screenEl.getBoundingClientRect().height : 0;
      const rowH = screenH > 0 && t.rows > 0 ? (screenH / t.rows).toFixed(1) : '?';
      const above = buf.viewportY;
      const below = Math.max(0, buf.length - t.rows - buf.viewportY);
      const vp = containerRef.current?.querySelector<HTMLElement>('.xterm-viewport');
      const sTop = vp ? Math.round(vp.scrollTop) : -1;
      const fit = (window as Window & { __argusFit?: number }).__argusFit ?? 0;
      const scrollDbg = (window as Window & { __argusScrollDebug?: string }).__argusScrollDebug ?? '-';
      setDebugStats(`↑${above} ↓${below} sTop:${sTop} fit:${fit} rowH:${rowH} | ${scrollDbg}`);
    };
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  // refs are stable — no need to list them
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugMode]);

  return (
    <>
      <div data-testid="mobile-terminal" style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <FocusTerminal containerRef={containerRef} />
        {debugMode && debugStats && (
          <div style={{
            position: 'absolute',
            bottom: 4,
            left: 4,
            right: 4,
            background: 'var(--bg-overlay)',
            color: 'var(--ok)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-tiny)',
            padding: 'var(--s-0-5) var(--s-1-5)',
            borderRadius: 'var(--r-1)',
            pointerEvents: 'none',
            zIndex: 100,
          }}>
            {debugStats}
          </div>
        )}
      </div>
      {keyboardOpen ? (
        <MobileKeyboard session={session} terminalRef={terminalRef} onClose={() => setKeyboardOpen(false)} />
      ) : (
        <button
          type="button"
          aria-label="Show keyboard"
          onClick={() => setKeyboardOpen(true)}
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--s-2)',
            width: '100%',
            padding: 'var(--s-2)',
            paddingBottom: 'calc(var(--s-2) + env(safe-area-inset-bottom, 0px))',
            background: 'var(--bg-1)',
            borderTop: '1px solid var(--line-2)',
            border: 'none',
            color: 'var(--fg-2)',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          <Icon icon={Keyboard} size="xl" />
        </button>
      )}
    </>
  );
}
