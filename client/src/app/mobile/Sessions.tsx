import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionInfo, SessionStatus } from '@argus/shared';
import { ChevronRight, MoreVertical, Plus, Play } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { StatusDot, StatusPill, DirtyBadge, Icon, Row, Stack, Text } from '../../components/primitives/index.js';
import { resolveGroupColor } from '../../constants/groupColors.js';
import { useTheme } from '../../context/theme-context.js';
import type { GroupedSessions, GhostFavorite } from '../../hooks/useGroups.js';
import { SessionIdentity } from '../ui/SessionIdentity.js';
import { PrChip } from '../ui/PrChip.js';
import { UsageChip } from '../ui/UsageChip.js';
import { StaleChip } from '../ui/StaleChip.js';
import { shellLabel } from '../../utils/sessionLabel.js';
import { identityEdgeProps } from '../../utils/sessionIdentity.js';
import { usageMeterView } from '../../utils/usageFormat.js';
import { formatWaiting } from '../overlays/inboxItems.js';

/** The phone has no settings of its own: the meter shows its default parts
 *  (context), without the account-wide plan usage. */
const MOBILE_METER = usageMeterView(null)!;

interface SessionsProps {
  sessions: SessionInfo[];
  grouped: GroupedSessions;
  publicUrl: string | null;
  onSelect: (id: string) => void;
  onAction: (session: SessionInfo) => void;
  onSpawnFavorite: (ghost: GhostFavorite) => void;
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

/** Two sessions on the same folder with the same name are indistinguishable in the
 *  list — same glyph, same subtitle, same age — and a phone has no hover or tooltip
 *  to break the tie. Identity key for spotting those. */
function identityKey(s: SessionInfo): string {
  return `${s.name}\u0000${s.folderPath}`;
}

/** Extra subtitle fragment shown only for sessions that collide: the worktree
 *  branch when there is one, otherwise a short id so the rows are at least
 *  individually addressable. */
function discriminator(s: SessionInfo): string {
  const branch = s.worktreePath?.split('/').filter(Boolean).pop();
  return branch ? ` · ${branch}` : ` · #${s.id.slice(0, 4)}`;
}

function byStatus(a: SessionInfo, b: SessionInfo): number {
  const ra = STATUS_RANK[a.status] ?? 2;
  const rb = STATUS_RANK[b.status] ?? 2;
  if (ra !== rb) return ra - rb;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function Section({ title, color, sessions, ghosts, filter, collidingKeys, onSelect, onAction, onSpawnFavorite }: { title: string; color: string | null; sessions: SessionInfo[]; ghosts?: GhostFavorite[]; filter: StatusFilter; collidingKeys: Set<string>; onSelect: (id: string) => void; onAction: (s: SessionInfo) => void; onSpawnFavorite?: (ghost: GhostFavorite) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const visible = filter === 'all' ? sessions : sessions.filter((s) => s.status === filter);
  // Ghost (saved, spun-down) favourites have no status, so only surface them in the unfiltered view.
  const visibleGhosts = filter === 'all' ? (ghosts ?? []) : [];
  if (visible.length === 0 && visibleGhosts.length === 0) return null;
  const sorted = [...visible].sort(byStatus);
  return (
    <div>
      <button
        onClick={() => setCollapsed((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--s-2)', width: '100%', textAlign: 'left',
          padding: 'var(--s-3) var(--s-4) var(--s-1)', background: 'var(--bg-1)',
          border: 'none', borderBottom: '1px solid var(--line-1)', cursor: 'pointer',
        }}
      >
        <Icon icon={ChevronRight} size="sm" strokeWidth={2}
          style={{ transform: collapsed ? 'none' : 'rotate(90deg)', transition: 'transform var(--dur-fast) var(--ease)', color: 'var(--fg-3)' }} />
        {color && <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'block' }} />}
        <span className="eyebrow" style={{ flex: 1 }}>{title}</span>
        <span className="eyebrow" style={{ color: 'var(--fg-3)' }}>{visible.length + visibleGhosts.length}</span>
      </button>
      {!collapsed && sorted.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          collides={collidingKeys.has(identityKey(s))}
          onSelect={() => onSelect(s.id)}
          onAction={() => onAction(s)}
        />
      ))}
      {!collapsed && visibleGhosts.map((g) => <GhostRow key={g.id} ghost={g} onSpawn={() => onSpawnFavorite?.(g)} />)}
    </div>
  );
}

/** A saved favourite with no live session — tap to relaunch a shell in its folder/agent/flags. */
function GhostRow({ ghost, onSpawn }: { ghost: GhostFavorite; onSpawn: () => void }) {
  const { meta } = ghost;
  const folder = meta.folderPath.split('/').filter(Boolean).pop() ?? meta.folderPath;
  return (
    <Row style={{ borderBottom: '1px solid var(--line-1)' }}>
      <button
        onClick={onSpawn}
        className="mobile-list-row"
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--s-3)',
          padding: 'var(--s-3) 0 var(--s-3) var(--s-4)', background: 'transparent', border: 'none',
          cursor: 'pointer', flex: 1, minWidth: 0, textAlign: 'left', minHeight: 64, opacity: 0.72,
        }}
      >
        <AgentGlyph agent={meta.agentType} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text as="div" mono size="body" weight={500} tone="default" truncate>
            {meta.name || folder}
          </Text>
          <Text as="div" className="eyebrow" truncate style={{ marginTop: 'var(--s-px)' }}>
            {folder} · saved
          </Text>
        </div>
      </button>
      <button
        onClick={onSpawn}
        aria-label={`Launch ${meta.name || folder}`}
        style={{
          width: 44, minHeight: 64, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent)', flexShrink: 0,
        }}
      >
        <Icon icon={Play} size="xl" />
      </button>
    </Row>
  );
}

/** How long a waiting session has waited, in the inbox's format ("2m"). */
function waitedFor(since: number): string {
  return formatWaiting(Date.now() - since);
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

function SessionRow({ session, collides, onSelect, onAction }: { session: SessionInfo; collides: boolean; onSelect: () => void; onAction: () => void }) {
  const folder = session.folderPath.split('/').filter(Boolean).pop() ?? session.folderPath;
  const { isDark } = useTheme();
  const edge = identityEdgeProps(session.color, isDark);
  const hasChips = !!session.pr || session.worktreeStaleDays !== undefined || !!session.usage;
  return (
    <Row
      data-identity-edge={edge['data-identity-edge']}
      style={{
        ...edge.style,
        borderBottom: '1px solid var(--line-1)',
      }}
    >
      <button
        onClick={onSelect}
        className="mobile-list-row"
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
          <Row
            gap={1.5}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-body)',
              fontWeight: 500,
              color: 'var(--fg-0)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            <SessionIdentity session={session} />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{shellLabel(session)}</span>
            {session.hasGitChanges && <DirtyBadge size="sm" />}
          </Row>
          <Text as="div" className="eyebrow" truncate style={{ marginTop: 'var(--s-px)' }}>
            {folder} · {session.status === 'waiting' && session.waitingSince !== undefined ? `waiting ${waitedFor(session.waitingSince)}` : timeAgo(session.createdAt)}{collides ? discriminator(session) : ''}
          </Text>
          {hasChips && (
            <div className="mobile-row-chips">
              {session.pr && <PrChip pr={session.pr} />}
              <StaleChip staleDays={session.worktreeStaleDays} />
              <UsageChip agentType={session.agentType} usage={session.usage} view={MOBILE_METER} />
            </div>
          )}
          {session.status === 'waiting' && session.lastPrompt && (
            <Text as="div" mono size="caption" tone="accent" truncate style={{ marginTop: 'var(--s-1)' }}>
              {session.lastPrompt}
            </Text>
          )}
        </div>
        <StatusPill status={session.status} size="sm" />
      </button>
      <button
        onClick={onAction}
        aria-label={`Actions for ${shellLabel(session)}`}
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
        <Icon icon={MoreVertical} size="xl" />
      </button>
    </Row>
  );
}

export function Sessions({ sessions, grouped, publicUrl, onSelect, onAction, onSpawnFavorite, onCreate }: SessionsProps) {
  // Group dots follow the theme — the dark-mode swatches vanish on light paper.
  const { isDark } = useTheme();
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

  const collidingKeys = useMemo(() => {
    const tally = new Map<string, number>();
    for (const s of sessions) {
      const k = identityKey(s);
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    return new Set([...tally].filter(([, n]) => n > 1).map(([k]) => k));
  }, [sessions]);

  // The filter row scrolls horizontally, and at phone width the last chip is cut
  // mid-word with nothing to suggest there is more. Fade whichever edge has
  // content beyond it, so the clipping reads as "scrollable" rather than "broken".
  const chipsRef = useRef<HTMLDivElement>(null);
  const [chipFade, setChipFade] = useState({ start: false, end: false });
  const syncChipFade = () => {
    const el = chipsRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = { start: el.scrollLeft > 2, end: max > 2 && el.scrollLeft < max - 2 };
    setChipFade((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  };
  // What decides whether the row overflows is its own width, not the session
  // count (FILTERS is static), so the row has to be re-measured whenever the
  // viewport changes: rotating a phone can turn a scrolling row into a fitting
  // one, and a fade left over from the other orientation reads as a bug.
  // ResizeObserver catches the element's own width, including the chrome around
  // it changing without a window resize; orientationchange covers Safari firing
  // it before the new layout is measurable.
  useEffect(() => {
    syncChipFade();
    const el = chipsRef.current;
    const ro = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncChipFade) : null;
    if (el && ro) ro.observe(el);
    const onOrientation = () => requestAnimationFrame(syncChipFade);
    window.addEventListener('orientationchange', onOrientation);
    window.addEventListener('resize', syncChipFade);
    return () => {
      ro?.disconnect();
      window.removeEventListener('orientationchange', onOrientation);
      window.removeEventListener('resize', syncChipFade);
    };
  }, []);
  // A chip row that appears/disappears with the session list needs one more
  // measure once it is actually in the DOM.
  useEffect(syncChipFade, [sessions.length]);
  const fadeStops = [
    chipFade.start ? 'transparent 0, #000 18px' : '#000 0',
    chipFade.end ? '#000 calc(100% - 18px), transparent 100%' : '#000 100%',
  ].join(', ');
  const chipMask = `linear-gradient(to right, ${fadeStops})`;

  return (
    <Stack style={{ height: '100%', background: 'var(--bg-0)' }}>
      <Row
        justify="between"
        style={{
          padding: '0 var(--s-4)',
          minHeight: 52,
          paddingTop: 'env(safe-area-inset-top, 0px)',
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        <span className="eyebrow" style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-0)' }}>ARGUS</span>
        <Row gap={3}>
          {publicUrl && (
            <Row as="span" gap={1} title="Remote tunnel connected">
              <StatusDot status="running" size={6} />
              <span className="eyebrow" style={{ fontSize: 'var(--t-micro)', color: 'var(--fg-3)' }}>tunnel</span>
            </Row>
          )}
          <span className="eyebrow" style={{ fontSize: 'var(--t-micro)', color: 'var(--fg-3)' }}>
            {sessions.length} · {sessions.length === 1 ? 'session' : 'sessions'}
          </span>
        </Row>
      </Row>

      {sessions.length > 0 && waiting.length > 0 && (
        <button
          onClick={() => onSelect(waiting[0].id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--s-3)', textAlign: 'left',
            margin: 'var(--s-3) var(--s-3) var(--s-1)', padding: 'var(--s-3) var(--s-3)', cursor: 'pointer',
            borderRadius: 'var(--r-3)', background: 'var(--status-waiting-bg)', border: '1px solid var(--accent-edge)',
            width: 'calc(100% - var(--s-3) * 2)',
          }}
        >
          <StatusDot status="waiting" size={8} pulse />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text as="div" size="body" weight={600} style={{ color: 'var(--fg-0)' }}>
              {waiting.length} {waiting.length === 1 ? 'session needs' : 'sessions need'} you
            </Text>
            <Text as="div" className="eyebrow" truncate style={{ color: 'var(--fg-2)' }}>
              {waiting.map((s) => s.name).join(' · ')}
            </Text>
          </div>
          <span className="eyebrow" style={{ fontWeight: 700, color: 'var(--fg-on-accent)', background: 'var(--accent)', borderRadius: 'var(--r-2)', padding: 'var(--s-1-5) var(--s-2)' }}>
            Jump →
          </span>
        </button>
      )}

      {sessions.length > 0 && (
        <div
          ref={chipsRef}
          onScroll={syncChipFade}
          style={{
            display: 'flex', gap: 'var(--s-1-5)', padding: 'var(--s-2) var(--s-3)', overflowX: 'auto',
            borderBottom: '1px solid var(--line-1)', flexShrink: 0,
            maskImage: chipMask, WebkitMaskImage: chipMask,
          }}
        >
          {FILTERS.map((f) => {
            const on = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                aria-pressed={on}
                className="eyebrow"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 'var(--s-1-5)', whiteSpace: 'nowrap',
                  padding: 'var(--s-1-5) var(--s-3)', borderRadius: 'var(--r-pill)', cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--accent-edge)' : 'var(--line-2)'}`,
                  background: on ? 'var(--accent-bg)' : 'var(--bg-1)',
                  color: on ? 'var(--accent)' : 'var(--fg-2)',
                  fontSize: 'var(--t-tiny)',
                }}
              >
                {f.label}<Text size="eyebrow" tone="faint">{counts[f.id]}</Text>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
        {sessions.length === 0 ? (
          <Stack
            align="center"
            justify="center"
            gap={4}
            style={{
              height: '70%',
              padding: '0 var(--s-7)',
              textAlign: 'center',
            }}
          >
            <Text as="div" mono size="body" tone="faint" style={{ lineHeight: 1.5 }}>
              No sessions yet.
            </Text>
            <button
              onClick={onCreate}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--s-1-5)',
                background: 'var(--accent)',
                color: 'var(--fg-on-accent)',
                border: 'none',
                borderRadius: 'var(--r-2)',
                padding: 'var(--s-3) var(--s-4)',
                fontSize: 'var(--t-body)',
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Icon icon={Plus} size="lg" strokeWidth={2} /> Create your first session
            </button>
          </Stack>
        ) : (
          <>
            {grouped.favorites && (
              <Section
                title="Favourites"
                color={resolveGroupColor('amber', isDark)}
                sessions={grouped.favorites.items.filter((i): i is SessionInfo => !('ghost' in i))}
                ghosts={grouped.favorites.items.filter((i): i is GhostFavorite => 'ghost' in i)}
                filter={filter}
                collidingKeys={collidingKeys}
                onSelect={onSelect}
                onAction={onAction}
                onSpawnFavorite={onSpawnFavorite}
              />
            )}
            {grouped.groups.map(({ group, sessions: gs }) => (
              <Section
                key={group.id}
                title={group.name}
                color={resolveGroupColor(group.color, isDark)}
                sessions={gs}
                filter={filter}
                collidingKeys={collidingKeys}
                onSelect={onSelect}
                onAction={onAction}
              />
            ))}
            <Section title="Others" color={grouped.othersColor ? resolveGroupColor(grouped.othersColor, isDark) : null} sessions={grouped.others} filter={filter} collidingKeys={collidingKeys} onSelect={onSelect} onAction={onAction} />
            {filter !== 'all' && counts[filter] === 0 && (
              <Row justify="center" style={{ padding: 'var(--s-8) var(--s-7)', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}>
                No {filter} sessions
              </Row>
            )}
          </>
        )}
      </div>

      {publicUrl && (
        <Row
          gap={2}
          style={{
            padding: 'var(--s-3) var(--s-4)',
            paddingBottom: 'calc(var(--s-3) + env(safe-area-inset-bottom, 0px))',
            background: 'var(--bg-1)',
            borderTop: '1px solid var(--line-2)',
            flexShrink: 0,
          }}
        >
          <StatusDot status="running" size={6} />
          <Text as="div" mono size="caption" tone="accent" truncate style={{ flex: 1, letterSpacing: 'var(--tracking-eye)' }}>
            {truncatedUrl}
          </Text>
          <span className="eyebrow" style={{ color: 'var(--fg-3)', fontSize: 'var(--t-micro)' }}>connected</span>
        </Row>
      )}
    </Stack>
  );
}
