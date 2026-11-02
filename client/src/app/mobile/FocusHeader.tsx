import type { SessionInfo } from '@argus/shared';
import { ChevronLeft, MoreVertical, GitBranch } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { SessionIdentity } from '../ui/SessionIdentity.js';
import { shellLabel } from '../../utils/sessionLabel.js';
import { StatusPill, DirtyBadge, Icon } from '../../components/primitives/index.js';

interface FocusHeaderProps {
  session: SessionInfo;
  onBack: () => void;
  onActions: () => void;
  onShowChanges: () => void;
}

export function FocusHeader({ session, onBack, onActions, onShowChanges }: FocusHeaderProps) {
  return (
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
        className="eyebrow"
        style={{
          background: 'transparent',
          border: '1px solid var(--line-2)',
          cursor: 'pointer',
          color: 'var(--accent)',
          borderRadius: 'var(--r-2)',
          padding: '0 var(--s-3)',
          minHeight: 'var(--row-h-touch)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-1)',
          flexShrink: 0,
          fontSize: 'var(--t-tiny)',
        }}
      >
        <Icon icon={ChevronLeft} size="md" />
        <span className="mobile-back-label">BACK</span>
      </button>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 'var(--s-1-5)', minWidth: 0, justifyContent: 'center' }}>
        <AgentGlyph agent={session.agentType} size={16} />
        <SessionIdentity session={session} />
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
          {shellLabel(session)}
        </span>
        {session.hasGitChanges && <DirtyBadge size="sm" />}
      </div>
      {/* Fixed width, right-aligned: the pill's own width tracks its label, so a
          status change (IDLE → RUNNING) used to widen it and truncate the session
          name mid-word — `bursttest` became `burst…` just because output started.
          Reserve the widest label's footprint so the title never reflows. */}
      <div style={{ flexShrink: 0, minWidth: 86, display: 'flex', justifyContent: 'flex-end' }}>
        <StatusPill status={session.status} size="sm" />
      </div>
      <button
        onClick={onShowChanges}
        aria-label="View changes"
        style={{
          background: 'transparent',
          border: '1px solid var(--line-2)',
          cursor: 'pointer',
          color: session.hasGitChanges ? 'var(--accent)' : 'var(--fg-2)',
          borderRadius: 'var(--r-2)',
          width: 44,
          minHeight: 'var(--row-h-touch)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon icon={GitBranch} size="lg" />
      </button>
      <button
        onClick={onActions}
        aria-label="Session actions"
        style={{
          background: 'transparent',
          border: '1px solid var(--line-2)',
          cursor: 'pointer',
          color: 'var(--fg-2)',
          borderRadius: 'var(--r-2)',
          width: 44,
          minHeight: 'var(--row-h-touch)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon icon={MoreVertical} size="lg" />
      </button>
    </div>
  );
}
