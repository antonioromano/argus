import { useEffect, useRef, useState } from 'react';
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

  // Focus owns the terminal lifecycle so the on-screen keyboard can share the
  // handle (DECCKM-aware arrows, local viewport scrolling).
  const { terminalRef } = useTerminal(containerRef, {
    sessionId: session.id,
    socket,
    theme,
    readOnly: true,
  });

  // Keep the terminal visible above the native keyboard. With
  // `interactive-widget=resizes-content` the layout viewport (and 100dvh)
  // shrink on their own; iOS Safari doesn't support that, so we fall back to
  // sizing the screen to the visualViewport when the keyboard occludes it.
  const [vvHeight, setVvHeight] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onChange = () => {
      const inset = window.innerHeight - vv.height - vv.offsetTop;
      setVvHeight(inset > 80 ? vv.height : null);
      window.dispatchEvent(new Event('terminal:refit'));
    };
    vv.addEventListener('resize', onChange);
    vv.addEventListener('scroll', onChange);
    return () => {
      vv.removeEventListener('resize', onChange);
      vv.removeEventListener('scroll', onChange);
    };
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: vvHeight != null ? `${vvHeight}px` : '100dvh',
        background: 'var(--bg-inset)',
        overflow: 'hidden',
      }}
    >
      <FocusHeader session={session} onBack={onBack} onActions={onActions} onShowChanges={() => setShowChanges(true)} />
      <FocusTerminal containerRef={containerRef} />
      <MobileKeyboard session={session} terminalRef={terminalRef} />
      {showChanges && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-sheet)' }}>
          <Diff session={session} onBack={() => setShowChanges(false)} />
        </div>
      )}
    </div>
  );
}
