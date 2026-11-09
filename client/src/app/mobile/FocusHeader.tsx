import type { SessionInfo } from '@argus/shared';
import { ChevronLeft, MoreVertical, GitBranch } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { SessionIdentity } from '../ui/SessionIdentity.js';
import { shellLabel } from '../../utils/sessionLabel.js';
import { AgentsChip } from '../ui/AgentsChip.js';
import { StatusPill, DirtyBadge, Icon, Row, Text } from '../../components/primitives/index.js';
import { displayStatus } from '../../utils/displayStatus.js';

interface FocusHeaderProps {
  session: SessionInfo;
  onBack: () => void;
  onActions: () => void;
  onShowChanges: () => void;
}

export function FocusHeader({ session, onBack, onActions, onShowChanges }: FocusHeaderProps) {
  return (
    <Row
      gap={2}
      style={{
        padding: '0 var(--s-3)',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        minHeight: 52,
        background: 'var(--bg-1)',
        borderBottom: '1px solid var(--line-2)',
        flexShrink: 0,
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
      <Row grow gap={1.5} justify="center">
        <AgentGlyph agent={session.agentType} size={16} />
        <SessionIdentity session={session} />
        <Text mono size="body" weight={500} truncate style={{ color: 'var(--fg-0)' }}>
          {shellLabel(session)}
        </Text>
        {session.hasGitChanges && <DirtyBadge size="sm" />}
      </Row>
      {/* Fixed width, right-aligned: the pill's own width tracks its label, so a
          status change (IDLE → RUNNING) used to widen it and truncate the session
          name mid-word — `bursttest` became `burst…` just because output started.
          Reserve the widest label's footprint so the title never reflows. */}
      <div style={{ flexShrink: 0, minWidth: 86, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--s-1)' }}>
        <StatusPill status={displayStatus(session)} size="sm" />
        {/* Stacked under the pill inside the same slot, so the title keeps its width when agents start. */}
        <AgentsChip count={session.agentsRunning ?? 0} />
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
    </Row>
  );
}
