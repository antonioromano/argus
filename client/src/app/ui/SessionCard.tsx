import type { SessionInfo } from '@argus/shared';
import { MoreHorizontal, PowerOff } from 'lucide-react';
import { AgentGlyph } from './AgentGlyph.js';
import { StatusBar, DirtyBadge, IconButton } from '../../components/primitives/index.js';
import { STATUS_COLORS, STATUS_LABELS } from '../../constants/status.js';

interface SessionCardProps {
  session: SessionInfo;
  lastOut?: string;
  onClick?: () => void;
  onMore?: (e: React.MouseEvent) => void;
  onKill?: () => void;
  onOpenDiff?: () => void;
  focus?: boolean;
}

function defaultLastOut(s: SessionInfo): string {
  if (s.status === 'waiting') return 'Awaiting input…';
  if (s.status === 'running') return 'Agent thinking…';
  if (s.status === 'idle') return 'Idle';
  return '[process exited]';
}

export function SessionCard({ session: s, lastOut, onClick, onMore, onKill, onOpenDiff, focus }: SessionCardProps) {
  const statusColor = STATUS_COLORS[s.status];
  const statusLabel = STATUS_LABELS[s.status];
  const preview = lastOut ?? defaultLastOut(s);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      aria-label={`Open shell ${s.name}, status ${statusLabel}, folder ${s.folderPath}`}
      className="terminal-card"
      data-status={s.status}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--bg-2)',
        border: `1px solid ${focus ? 'var(--accent-edge)' : 'var(--line-2)'}`,
        borderRadius: 'var(--r-2)',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        transition: 'border-color var(--dur-fast), transform var(--dur-fast)',
        boxShadow:
          s.status === 'waiting'
            ? '0 8px 24px var(--accent-glow)'
            : 'var(--shadow-1)',
      }}
    >
      <StatusBar status={s.status} height={3} />

      <div
        style={{
          padding: 'var(--s-3) var(--s-3) var(--s-2)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--s-2)',
        }}
      >
        <AgentGlyph agent={s.agentType} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-sm)',
              fontWeight: 500,
              color: 'var(--fg-0)',
              overflow: 'hidden',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {s.name}
            </span>
            {s.worktreeBranch && (
              <span
                style={{
                  flexShrink: 0,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--t-micro)',
                  letterSpacing: 'var(--tracking-eye)',
                  background: 'var(--accent-bg)',
                  color: 'var(--accent)',
                  border: '1px solid var(--accent-edge)',
                  borderRadius: 'var(--r-1)',
                  padding: '1px 5px',
                  maxWidth: 120,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={s.worktreeBranch}
              >
                {s.worktreeBranch}
              </span>
            )}
          </div>
          <div
            className="eyebrow"
            style={{
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {s.folderPath}
          </div>
        </div>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-micro)',
            color: statusColor,
            letterSpacing: 'var(--tracking-eye)',
            flexShrink: 0,
          }}
        >
          {statusLabel}
        </span>
      </div>

      <div
        style={{
          margin: '0 var(--s-3)',
          background: 'var(--bg-inset)',
          border: `1px solid ${s.status === 'waiting' ? 'var(--accent-edge)' : 'var(--line-1)'}`,
          boxShadow: s.status === 'waiting' ? '0 0 0 1px var(--accent-edge)' : undefined,
          borderRadius: 'var(--r-1)',
          padding: 'var(--s-2) var(--s-3)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-tiny)',
          color: 'var(--fg-2)',
          lineHeight: 1.6,
          minHeight: 120,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ color: 'var(--fg-3)' }}>$ {s.agentType}</div>
        <div
          style={{
            marginTop: 4,
            color: s.status === 'waiting' ? 'var(--accent)' : 'var(--fg-1)',
          }}
        >
          {s.status === 'waiting' && <span style={{ color: 'var(--fg-3)' }}>› </span>}
          {preview}
          {(s.status === 'waiting' || s.status === 'idle') && (
            <span style={{ animation: 'argus-blink 1s steps(1) infinite' }}>▌</span>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          padding: 'var(--s-2) var(--s-3) var(--s-3)',
          marginTop: 'auto',
        }}
      >
        <span className="eyebrow" style={{ color: 'var(--fg-3)' }}>
          {s.agentType}
        </span>
        {s.flags.length > 0 && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-micro)',
              color: 'var(--fg-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {s.flags.join(' ')}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {s.hasGitChanges && <DirtyBadge size="sm" onClick={onOpenDiff ? () => onOpenDiff() : undefined} />}
        {onMore && (
          <IconButton
            icon={MoreHorizontal}
            label="Shell menu"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onMore(e); }}
          />
        )}
        {onKill && (
          <IconButton
            icon={PowerOff}
            label="Close shell"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onKill(); }}
          />
        )}
      </div>
    </div>
  );
}
