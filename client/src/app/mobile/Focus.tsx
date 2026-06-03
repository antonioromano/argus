import { useEffect, useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import { ChevronLeft } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { StatusPill, DirtyBadge } from '../../components/primitives/index.js';
import { useSocket } from '../../hooks/useSocket.js';
import { MobileTerminal } from './MobileTerminal.js';
import { MobileKeyboard } from './keyboard/MobileKeyboard.js';

interface FocusProps {
  session: SessionInfo;
  onBack: () => void;
}

export function Focus({ session, onBack }: FocusProps) {
  const socket = useSocket();

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
    <div style={{ display: 'flex', flexDirection: 'column', height: vvHeight != null ? `${vvHeight}px` : '100dvh', background: 'var(--bg-inset)', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 var(--s-3)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          minHeight: 52,
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
          gap: 'var(--s-2)',
        }}
      >
        <button
          onClick={onBack}
          aria-label="Back to shells"
          className="eyebrow"
          style={{
            background: 'transparent',
            border: '1px solid var(--line-2)',
            cursor: 'pointer',
            color: 'var(--accent)',
            borderRadius: 'var(--r-2)',
            padding: '0 12px',
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexShrink: 0,
            fontSize: 'var(--t-tiny)',
          }}
        >
          <ChevronLeft size={14} strokeWidth={1.6} />
          BACK
        </button>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, justifyContent: 'center' }}>
          <AgentGlyph agent={session.agentType} size={16} />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-sm)',
              fontWeight: 500,
              color: 'var(--fg-0)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {session.name}
          </span>
          {session.hasGitChanges && <DirtyBadge size="sm" />}
        </div>
        <div style={{ flexShrink: 0 }}>
          <StatusPill status={session.status} size="sm" />
        </div>
      </div>

      <MobileTerminal sessionId={session.id} socket={socket} />

      <MobileKeyboard session={session} />
    </div>
  );
}
