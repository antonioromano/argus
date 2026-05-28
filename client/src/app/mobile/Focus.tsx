import { useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import { ChevronLeft } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { StatusPill, DirtyBadge } from '../../components/primitives/index.js';
import { useSocket } from '../../hooks/useSocket.js';
import { MobileTerminal } from './MobileTerminal.js';
import { ActionBar } from './ActionBar.js';

interface FocusProps {
  session: SessionInfo;
  onBack: () => void;
}

export function Focus({ session, onBack }: FocusProps) {
  const socket = useSocket();
  const [lastLine, setLastLine] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--bg-inset)' }}>
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
          aria-label="Back to sessions"
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
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-tiny)',
            letterSpacing: 'var(--tracking-eye)',
            textTransform: 'uppercase',
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

      <MobileTerminal sessionId={session.id} socket={socket} onTail={setLastLine} />

      <ActionBar session={session} lastRawLine={lastLine} />
    </div>
  );
}
