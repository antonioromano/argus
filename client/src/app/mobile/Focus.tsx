import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'lucide-react';
import type { SessionInfo } from '@argus/shared';
import { useSocket } from '../../hooks/useSocket.js';
import { useTerminal } from '../../hooks/useTerminal.js';
import { useTheme } from '../../context/theme-context.js';
import { FocusHeader } from './FocusHeader.js';
import { FocusTerminal } from './FocusTerminal.js';
import { Diff } from './Diff.js';
import { MobileKeyboard } from './keyboard/MobileKeyboard.js';

interface FocusProps {
  session: SessionInfo;
  onBack: () => void;
  onActions: () => void;
}

export function Focus({ session, onBack, onActions }: FocusProps) {
  const socket = useSocket();
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(true);

  // The input surface changes height when shown/hidden — refit the terminal.
  useEffect(() => { window.dispatchEvent(new Event('terminal:refit')); }, [keyboardOpen]);

  // Focus owns the terminal lifecycle so the on-screen keyboard can share the
  // handle (DECCKM-aware arrows, local viewport scrolling).
  const { terminalRef } = useTerminal(containerRef, {
    sessionId: session.id,
    socket,
    theme,
    readOnly: true,
  });

  // Lock the container to a fixed pixel height derived from visualViewport.height.
  //
  // Why not `100dvh`: iOS Safari animates dvh as its toolbar shows/hides during
  // scroll. That CSS change triggers the ResizeObserver on the terminal container →
  // fitAddon.fit() mid-gesture → xterm re-layout → jumpy/stalling scroll.
  //
  // Fix: always use vv.height as a fixed pixel value. Debounce updates by 150ms so
  // the toolbar animation (which fires many events over ~300ms) only causes ONE
  // refit after it settles, never mid-gesture.
  const vv0 = window.visualViewport;
  const [vvHeight, setVvHeight] = useState<number>(
    vv0 ? Math.round(vv0.height) : window.innerHeight,
  );
  const vvHeightRef = useRef<number>(vvHeight);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let timer = 0;
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
      const scrollDbg = (window as Window & { __argusScrollDebug?: string }).__argusScrollDebug ?? '-';
      setDebugStats(`buf:${buf.type} ↑${above} ↓${below} rows:${t.rows} rowH:${rowH}px | ${scrollDbg}`);
    };
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  // refs are stable — no need to list them
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugMode]);

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
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <FocusTerminal containerRef={containerRef} />
        {debugMode && debugStats && (
          <div style={{
            position: 'absolute',
            bottom: 4,
            left: 4,
            right: 4,
            background: 'rgba(0,0,0,0.75)',
            color: '#0f0',
            fontFamily: 'monospace',
            fontSize: 11,
            padding: '3px 6px',
            borderRadius: 4,
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
          <Keyboard size={18} />
        </button>
      )}
      {showChanges && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-sheet)' }}>
          <Diff session={session} onBack={() => setShowChanges(false)} />
        </div>
      )}
    </div>
  );
}
