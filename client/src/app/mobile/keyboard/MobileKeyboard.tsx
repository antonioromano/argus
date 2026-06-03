import { useState, useRef, useEffect } from 'react';
import type { RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { SessionInfo } from '@argus/shared';
import { useSocket } from '../../../hooks/useSocket.js';
import { useKeyboardMode } from '../../../hooks/useKeyboardMode.js';
import { KEY, arrow, isArrow, isScroll, composeSubmit, type KeyId } from './keys.js';
import { SpecialPad } from './SpecialPad.js';
import { SpecialToolbar } from './SpecialToolbar.js';
import { ComposeBar } from './ComposeBar.js';
import { CustomQwerty } from './CustomQwerty.js';

interface MobileKeyboardProps {
  session: SessionInfo;
  /** Shared xterm handle (owned by Focus) — used for DECCKM-aware arrows and
   *  local viewport scrolling. */
  terminalRef: RefObject<Terminal | null>;
}

/** Notify the terminal to refit when the surface height changes. */
function refit() {
  window.dispatchEvent(new Event('terminal:refit'));
}

const surfaceStyle: React.CSSProperties = {
  background: 'var(--bg-1)',
  borderTop: '1px solid var(--line-2)',
  flexShrink: 0,
};

/**
 * The mobile input surface below the terminal. Branches on the persisted
 * keyboard mode: Hybrid (special pad + native keyboard on demand) or Dual
 * (two-view fully custom keyboard). Routes every key through the central
 * encoder; arrows are DECCKM-aware and scroll keys move the viewport locally.
 */
export function MobileKeyboard({ session, terminalRef }: MobileKeyboardProps) {
  const socket = useSocket();
  const [mode] = useKeyboardMode();
  const [view, setView] = useState<'keys' | 'text'>('keys');
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  // The surface changes height on view/mode swap — refit the terminal above it.
  useEffect(() => { refit(); }, [view, mode]);

  const send = (data: string) => socket.emit('session:input', { sessionId: session.id, data });

  const onKey = (id: KeyId) => {
    navigator.vibrate?.(8);
    if (isScroll(id)) {
      const t = terminalRef.current;
      if (id === 'top') t?.scrollToTop();
      else t?.scrollToBottom();
      return;
    }
    if (isArrow(id)) {
      const appCursor = terminalRef.current?.modes.applicationCursorKeysMode ?? false;
      send(arrow(id, appCursor));
      return;
    }
    send(KEY[id]);
  };

  const submit = () => {
    if (!text.trim()) return;
    navigator.vibrate?.(8);
    send(composeSubmit(text));
    setText('');
    if (taRef.current) taRef.current.style.height = 'auto';
  };

  // Hybrid: reveal the compose field and focus it within the tap gesture so iOS
  // raises the native keyboard.
  const summonNative = () => {
    setView('text');
    requestAnimationFrame(() => taRef.current?.focus());
  };
  const dismissNative = () => {
    taRef.current?.blur();
    setView('keys');
  };

  if (mode === 'hybrid') {
    return (
      <div style={surfaceStyle}>
        {view === 'keys' ? (
          <SpecialPad onKey={onKey} onAbc={summonNative} />
        ) : (
          <>
            <SpecialToolbar onKey={onKey} onBackToKeys={dismissNative} />
            <div style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
              <ComposeBar ref={taRef} value={text} onChange={setText} onSubmit={submit} nativeInput />
            </div>
          </>
        )}
      </div>
    );
  }

  // Dual: fully custom, never raises the native keyboard.
  return (
    <div style={surfaceStyle}>
      <div style={{ display: 'flex', gap: 'var(--s-1)', padding: 'var(--s-2)', background: 'var(--bg-2)', borderBottom: '1px solid var(--line-1)' }}>
        {(['keys', 'text'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className="eyebrow"
            style={{
              flex: 1,
              padding: 'var(--s-2)',
              borderRadius: 'var(--r-2)',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              background: view === v ? 'var(--accent-bg)' : 'transparent',
              color: view === v ? 'var(--accent)' : 'var(--fg-2)',
            }}
          >
            {v === 'keys' ? '⌨ KEYS' : 'abc TEXT'}
          </button>
        ))}
      </div>

      {view === 'keys' ? (
        <SpecialPad onKey={onKey} />
      ) : (
        <>
          <ComposeBar ref={taRef} value={text} onChange={setText} onSubmit={submit} nativeInput={false} />
          <CustomQwerty
            onChar={(c) => setText((t) => t + c)}
            onBackspace={() => setText((t) => t.slice(0, -1))}
            onNewline={() => setText((t) => t + '\n')}
            onSubmit={submit}
          />
        </>
      )}
    </div>
  );
}
