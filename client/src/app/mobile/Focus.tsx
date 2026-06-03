import { useState, useRef, useEffect } from 'react';
import type { SessionInfo } from '@argus/shared';
import { useSocket } from '../../hooks/useSocket.js';
import { useTerminal } from '../../hooks/useTerminal.js';
import { FocusHeader } from './FocusHeader.js';
import { FocusTerminal } from './FocusTerminal.js';
import { Chips } from './Chips.js';
import { KeyStrip } from './KeyStrip.js';
import { ComposeBar } from './ComposeBar.js';
import { detect } from './focusKeys.js';

interface FocusProps {
  session: SessionInfo;
  onBack: () => void;
}

/** Track the visual viewport height so the layout compresses (instead of being
 *  overlaid) when the iOS soft keyboard opens. Falls back to 100dvh via null. */
function useViewportHeight(): number | null {
  const [h, setH] = useState<number | null>(() => window.visualViewport?.height ?? null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setH(vv.height);
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return h;
}

export function Focus({ session, onBack }: FocusProps) {
  const socket = useSocket();
  const [lastLine, setLastLine] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportHeight = useViewportHeight();

  const { terminalRef } = useTerminal(containerRef, {
    sessionId: session.id,
    socket,
    theme: 'dark',
    readOnly: true,
    onTail: setLastLine,
  });

  const send = (data: string) => socket.emit('session:input', { sessionId: session.id, data });
  const chips = detect(lastLine);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: viewportHeight != null ? `${viewportHeight}px` : '100dvh',
        background: 'var(--bg-inset)',
        overflow: 'hidden',
      }}
    >
      <FocusHeader session={session} onBack={onBack} />
      <FocusTerminal containerRef={containerRef} />
      <Chips chips={chips} send={send} />
      <KeyStrip terminalRef={terminalRef} send={send} />
      <ComposeBar send={send} />
    </div>
  );
}
