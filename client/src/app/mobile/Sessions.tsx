import { useState } from 'react';
import type { SessionInfo, SessionStatus } from '@argus/shared';
import { ChevronRight, MoreVertical, Plus } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { StatusDot, StatusPill, DirtyBadge } from '../../components/primitives/index.js';
import { resolveGroupColor } from '../../constants/groupColors.js';
import type { GroupedSessions } from '../../hooks/useGroups.js';

interface SessionsProps {
  sessions: SessionInfo[];
  grouped: GroupedSessions;
  publicUrl: string | null;
  onSelect: (id: string) => void;
  onAction: (session: SessionInfo) => void;
  onCreate: () => void;
}

type StatusFilter = 'all' | SessionStatus;

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'done', label: 'Done' },
  { id: 'running', label: 'Running' },
  { id: 'idle', label: 'Idle' },
];

const STATUS_RANK: Partial<Record<SessionStatus, number>> = { waiting: 0, done: 1 };

function byStatus(a: SessionInfo, b: SessionInfo): number {
  const ra = STATUS_RANK[a.status] ?? 2;
  const rb = STATUS_RANK[b.status] ?? 2;
  if (ra !== rb) return ra - rb;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function Section({ title, color, sessions, filter, onSelect, onAction }: { title: string; color: string | null; sessions: SessionInfo[]; filter: StatusFilter; onSelect: (id: string) => void; onAction: (s: SessionInfo) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const visible = filter === 'all' ? sessions : sessions.filter((s) => s.status === filter);
  if (visible.length === 0) return null;
  const sorted = [...visible].sort(byStatus);
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
        <span className="eyebrow" style={{ color: 'var(--fg-3)' }}>{visible.length}</span>
      </button>
      {!collapsed && sorted.map((s) => <Row key={s.id} session={s} onSelect={() => onSelect(s.id)} onAction={() => onAction(s)} />)}
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

function Row({ session, onSelect, onAction }: { session: SessionInfo; onSelect: () => void; onAction: () => void }) {
  const folder = session.folderPath.split('/').filter(Boolean).pop() ?? session.folderPath;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid var(--line-1)',
      }}
    >
      <button
        onClick={onSelect}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-3)',
          padding: 'var(--s-3) 0 var(--s-3) var(--s-4)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          flex: 1,
          minWidth: 0,
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
          {session.status === 'waiting' && session.lastPrompt && (
            <div
              style={{
                marginTop: 3,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-tiny)',
                color: 'var(--accent)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {session.lastPrompt}
            </div>
          )}
        </div>
        <StatusPill status={session.status} size="sm" />
      </button>
      <button
        onClick={onAction}
        aria-label={`Actions for ${session.name}`}
        style={{
          width: 44,
          minHeight: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--fg-3)',
          flexShrink: 0,
        }}
      >
        <MoreVertical size={18} strokeWidth={1.6} />
      </button>
    </div>
  );
}

export function Sessions({ sessions, grouped, publicUrl, onSelect, onAction, onCreate }: SessionsProps) {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const truncatedUrl = publicUrl
    ? publicUrl.replace(/^https?:\/\//, '').slice(0, 28) + (publicUrl.length > 32 ? '…' : '')
    : null;

  const counts: Record<StatusFilter, number> = {
    all: sessions.length,
    waiting: 0, running: 0, idle: 0, done: 0, exited: 0,
  };
  for (const s of sessions) counts[s.status] += 1;
  const waiting = sessions.filter((s) => s.status === 'waiting');

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
          {publicUrl && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="Remote tunnel connected">
              <StatusDot status="running" size={6} />
              <span className="eyebrow" style={{ fontSize: 'var(--t-micro)', color: 'var(--fg-3)' }}>tunnel</span>
            </span>
          )}
          <span className="eyebrow" style={{ fontSize: 'var(--t-micro)', color: 'var(--fg-3)' }}>
            {sessions.length} · {sessions.length === 1 ? 'shell' : 'shells'}
          </span>
        </div>
      </div>

      {sessions.length > 0 && waiting.length > 0 && (
        <button
          onClick={() => onSelect(waiting[0].id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--s-3)', textAlign: 'left',
            margin: 'var(--s-3) var(--s-3) var(--s-1)', padding: '10px var(--s-3)', cursor: 'pointer',
            borderRadius: 'var(--r-3)', background: 'var(--status-waiting-bg)', border: '1px solid var(--accent-edge)',
            width: 'calc(100% - var(--s-3) * 2)',
          }}
        >
          <StatusDot status="waiting" size={8} pulse />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--t-sm)', fontWeight: 600, color: 'var(--fg-0)' }}>
              {waiting.length} {waiting.length === 1 ? 'shell needs' : 'shells need'} you
            </div>
            <div className="eyebrow" style={{ color: 'var(--fg-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {waiting.map((s) => s.name).join(' · ')}
            </div>
          </div>
          <span className="eyebrow" style={{ fontWeight: 700, color: 'var(--fg-on-accent)', background: 'var(--accent)', borderRadius: 'var(--r-2)', padding: '5px 9px' }}>
            Jump →
          </span>
        </button>
      )}

      {sessions.length > 0 && (
        <div style={{ display: 'flex', gap: 6, padding: 'var(--s-2) var(--s-3)', overflowX: 'auto', borderBottom: '1px solid var(--line-1)', flexShrink: 0 }}>
          {FILTERS.map((f) => {
            const on = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                aria-pressed={on}
                className="eyebrow"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                  padding: '5px 11px', borderRadius: 'var(--r-pill)', cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--accent-edge)' : 'var(--line-2)'}`,
                  background: on ? 'var(--accent-bg)' : 'var(--bg-1)',
                  color: on ? 'var(--accent)' : 'var(--fg-2)',
                  fontSize: 'var(--t-tiny)',
                }}
              >
                {f.label}<span style={{ color: 'var(--fg-3)', fontSize: 9 }}>{counts[f.id]}</span>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
        {sessions.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '70%',
              gap: 'var(--s-4)',
              padding: '0 var(--s-7)',
              textAlign: 'center',
            }}
          >
            <div style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)', lineHeight: 1.5 }}>
              No shells yet.
            </div>
            <button
              onClick={onCreate}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--accent)',
                color: 'var(--fg-on-accent)',
                border: 'none',
                borderRadius: 'var(--r-2)',
                padding: '10px var(--s-4)',
                fontSize: 'var(--t-base)',
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Plus size={16} strokeWidth={2} /> Create your first shell
            </button>
          </div>
        ) : (
          <>
            {grouped.favorites && (
              <Section
                title="Favourites"
                color={resolveGroupColor('amber', true)}
                sessions={grouped.favorites.items.filter((i): i is SessionInfo => !('ghost' in i))}
                filter={filter}
                onSelect={onSelect}
                onAction={onAction}
              />
            )}
            {grouped.groups.map(({ group, sessions: gs }) => (
              <Section
                key={group.id}
                title={group.name}
                color={resolveGroupColor(group.color, true)}
                sessions={gs}
                filter={filter}
                onSelect={onSelect}
                onAction={onAction}
              />
            ))}
            <Section title="Others" color={grouped.othersColor ? resolveGroupColor(grouped.othersColor, true) : null} sessions={grouped.others} filter={filter} onSelect={onSelect} onAction={onAction} />
          </>
        )}
      </div>

      {publicUrl && (
        <div
          style={{
            padding: 'var(--s-3) var(--s-4)',
            paddingBottom: 'calc(var(--s-3) + env(safe-area-inset-bottom, 0px))',
            background: 'var(--bg-1)',
            borderTop: '1px solid var(--line-2)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s-2)',
          }}
        >
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
          <span className="eyebrow" style={{ color: 'var(--fg-3)', fontSize: 'var(--t-micro)' }}>connected</span>
        </div>
      )}
    </div>
  );
}
