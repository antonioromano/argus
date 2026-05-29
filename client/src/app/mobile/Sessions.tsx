import { useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import { Wifi, Share2, ChevronRight } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { StatusDot, StatusPill, DirtyBadge } from '../../components/primitives/index.js';
import { resolveGroupColor } from '../../constants/groupColors.js';
import type { GroupedSessions } from '../../hooks/useGroups.js';

interface SessionsProps {
  sessions: SessionInfo[];
  grouped: GroupedSessions;
  publicUrl: string | null;
  onSelect: (id: string) => void;
  onRemote: () => void;
}

function byStatus(a: SessionInfo, b: SessionInfo): number {
  if (a.status === 'waiting' && b.status !== 'waiting') return -1;
  if (b.status === 'waiting' && a.status !== 'waiting') return 1;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function Section({ title, color, sessions, onSelect }: { title: string; color: string | null; sessions: SessionInfo[]; onSelect: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  if (sessions.length === 0) return null;
  const sorted = [...sessions].sort(byStatus);
  return (
    <div>
      <button
        onClick={() => setCollapsed((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
          padding: 'var(--s-3) var(--s-4) var(--s-1)', background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line-1)', border: 'none', cursor: 'pointer',
        }}
      >
        <ChevronRight size={12} strokeWidth={2}
          style={{ transform: collapsed ? 'none' : 'rotate(90deg)', transition: 'transform 150ms ease', color: 'var(--fg-3)' }} />
        {color && <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'block' }} />}
        <span className="eyebrow" style={{ flex: 1 }}>{title}</span>
        <span className="eyebrow" style={{ color: 'var(--fg-3)' }}>{sessions.length}</span>
      </button>
      {!collapsed && sorted.map((s) => <Row key={s.id} session={s} onSelect={() => onSelect(s.id)} />)}
    </div>
  );
}

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(diff / 3_600_000);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function Row({ session, onSelect }: { session: SessionInfo; onSelect: () => void }) {
  const folder = session.folderPath.split('/').filter(Boolean).pop() ?? session.folderPath;
  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-3)',
        padding: 'var(--s-3) var(--s-4)',
        background: 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--line-1)',
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
        minHeight: 64,
      }}
    >
      <AgentGlyph agent={session.agentType} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-base)',
            fontWeight: 500,
            color: 'var(--fg-0)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {session.name}
          {session.hasGitChanges && <DirtyBadge size="sm" />}
        </div>
        <div
          className="eyebrow"
          style={{
            marginTop: 2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {folder} · {timeAgo(session.createdAt)}
        </div>
      </div>
      <StatusPill status={session.status} size="sm" />
    </button>
  );
}

export function Sessions({ sessions, grouped, publicUrl, onSelect, onRemote }: SessionsProps) {
  const truncatedUrl = publicUrl
    ? publicUrl.replace(/^https?:\/\//, '').slice(0, 28) + (publicUrl.length > 32 ? '…' : '')
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-0)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 var(--s-4)',
          minHeight: 52,
          paddingTop: 'env(safe-area-inset-top, 0px)',
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        <span className="eyebrow" style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-0)' }}>ARGUS</span>
        <span
          className="eyebrow"
          style={{ fontSize: 'var(--t-micro)', color: 'var(--fg-3)' }}
        >
          {sessions.length} · {sessions.length === 1 ? 'shell' : 'shells'}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
        {sessions.length === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '60%',
              padding: '0 var(--s-7)',
              textAlign: 'center',
              color: 'var(--fg-3)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-sm)',
            }}
          >
            No sessions. Open Argus on your Mac to create sessions.
          </div>
        ) : (
          <>
            {grouped.groups.map(({ group, sessions: gs }) => (
              <Section
                key={group.id}
                title={group.name}
                color={resolveGroupColor(group.color, true)}
                sessions={gs}
                onSelect={onSelect}
              />
            ))}
            <Section title="Others" color={grouped.othersColor ? resolveGroupColor(grouped.othersColor, true) : null} sessions={grouped.others} onSelect={onSelect} />
          </>
        )}
      </div>

      <div
        style={{
          padding: 'var(--s-3) var(--s-4)',
          paddingBottom: 'calc(var(--s-3) + env(safe-area-inset-bottom, 0px))',
          background: 'var(--bg-1)',
          borderTop: '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        {publicUrl ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
            <StatusDot status="running" size={6} />
            <div
              style={{
                flex: 1,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-tiny)',
                color: 'var(--accent)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                letterSpacing: 'var(--tracking-eye)',
              }}
            >
              {truncatedUrl}
            </div>
            <button
              onClick={onRemote}
              style={{
                background: 'var(--accent)',
                color: 'var(--fg-on-accent)',
                border: 'none',
                borderRadius: 'var(--r-2)',
                padding: '6px var(--s-3)',
                fontSize: 'var(--t-sm)',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Share2 size={12} strokeWidth={1.6} /> Share
            </button>
          </div>
        ) : (
          <button
            onClick={onRemote}
            style={{
              width: '100%',
              background: 'var(--accent-bg)',
              color: 'var(--accent)',
              border: '1px solid var(--accent-edge)',
              borderRadius: 'var(--r-2)',
              padding: '10px var(--s-4)',
              fontSize: 'var(--t-base)',
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Wifi size={14} strokeWidth={1.6} /> Enable Remote Access
          </button>
        )}
      </div>
    </div>
  );
}
