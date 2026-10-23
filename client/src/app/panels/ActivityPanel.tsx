import { useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { ActivityEvent, ActivityEventType, ClientToServerEvents, ServerToClientEvents, SessionInfo } from '@argus/shared';
import type { LucideIcon } from 'lucide-react';
import { Activity, Archive, Bell, Bot, CircleStop, MessageSquare, Wrench } from 'lucide-react';
import { api } from '../../services/api.js';
import { ACTIVITY_CLIENT_CAP, relativeTime } from './activityFormat.js';
import { Icon } from '../../components/primitives/index.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const TYPE_META: Record<ActivityEventType, { label: string; icon: LucideIcon }> = {
  tool: { label: 'Tools', icon: Wrench },
  subagent: { label: 'Subagents', icon: Bot },
  compact: { label: 'Compactions', icon: Archive },
  prompt: { label: 'Prompts', icon: MessageSquare },
  notification: { label: 'Notifications', icon: Bell },
  stop: { label: 'Stops', icon: CircleStop },
};
const TYPES = Object.keys(TYPE_META) as ActivityEventType[];

export type ActivityFilter = 'all' | ActivityEventType;

/** Merge entries by id, oldest first, capped. */
function merge(prev: ActivityEvent[], next: ActivityEvent[]): ActivityEvent[] {
  const byId = new Map<number, ActivityEvent>();
  for (const e of prev) byId.set(e.id, e);
  for (const e of next) byId.set(e.id, e);
  const all = [...byId.values()].sort((a, b) => a.id - b.id);
  return all.length > ACTIVITY_CLIENT_CAP ? all.slice(all.length - ACTIVITY_CLIENT_CAP) : all;
}

/**
 * The session's activity: fetched on open, appended live from the session's
 * room. A native-engine viewer never joins the room, so the list is also
 * refetched when the session's status changes (an agent turn starting or ending).
 */
function useSessionActivity(session: SessionInfo, socket: TypedSocket): { events: ActivityEvent[]; error: boolean } {
  const [state, setState] = useState<{ sessionId: string; events: ActivityEvent[]; error: boolean }>({ sessionId: session.id, events: [], error: false });
  if (state.sessionId !== session.id) setState({ sessionId: session.id, events: [], error: false });

  useEffect(() => {
    const ctl = new AbortController();
    api.getSessionActivity(session.id, ctl.signal)
      .then((r) => setState((s) => (s.sessionId === session.id ? { ...s, events: merge(s.events, r.events), error: false } : s)))
      .catch(() => {
        if (!ctl.signal.aborted) setState((s) => (s.sessionId === session.id ? { ...s, error: true } : s));
      });
    return () => ctl.abort();
  }, [session.id, session.status]);

  useEffect(() => {
    const onEvent = (p: { sessionId: string; event: ActivityEvent }) => {
      if (p.sessionId !== session.id) return;
      setState((s) => (s.sessionId === session.id ? { ...s, events: merge(s.events, [p.event]) } : s));
    };
    socket.on('session:activity', onEvent);
    return () => {
      socket.off('session:activity', onEvent);
    };
  }, [socket, session.id]);

  return { events: state.sessionId === session.id ? state.events : [], error: state.error };
}

interface ActivityPanelProps {
  session: SessionInfo;
  socket: TypedSocket;
  /** 'side' docks to the right of the conversation, 'bottom' below it (stacked layout). */
  placement?: 'side' | 'bottom';
  /** Width when docked to the side, height when docked to the bottom. */
  size?: number;
  /** Open a file entry in the explorer. */
  onOpenFile?: (filePath: string) => void;
}

/** Beta F6: newest-first feed of what the agent did. Rendered only while the flag is on. */
export function ActivityPanel({ session, socket, placement = 'side', size = 320, onOpenFile }: ActivityPanelProps) {
  const { events, error } = useSessionActivity(session, socket);
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const shown = useMemo(() => {
    const list = filter === 'all' ? events : events.filter((e) => e.type === filter);
    return [...list].reverse();
  }, [events, filter]);

  return (
    <aside
      data-testid="activity-panel"
      style={{
        ...(placement === 'bottom'
          ? { height: size, flexShrink: 1, minHeight: 0, borderTop: '1px solid var(--line-2)' }
          : { width: size, flexShrink: 0, borderLeft: '1px solid var(--line-2)' }),
        background: 'var(--bg-1)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          height: 'var(--h-panel-header)',
          boxSizing: 'border-box',
          padding: '0 var(--s-3) 0 var(--s-4)',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        <Icon icon={Activity} size={13} strokeWidth={1.6} color="var(--fg-2)" />
        <span style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-1)', flex: 1, minWidth: 0 }}>Activity</span>
        <select
          aria-label="Filter activity by type"
          value={filter}
          onChange={(e) => setFilter(e.target.value as ActivityFilter)}
          style={{
            background: 'var(--bg-2)',
            color: 'var(--fg-1)',
            border: '1px solid var(--line-2)',
            borderRadius: 4,
            fontSize: 'var(--t-tiny)',
            padding: '1px 4px',
          }}
        >
          <option value="all">All</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_META[t].label}</option>
          ))}
        </select>
      </div>
      <div role="list" aria-label="Agent activity" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {shown.length === 0 && (
          <div style={{ padding: 'var(--s-4)', color: 'var(--fg-3)', fontSize: 'var(--t-sm)' }}>
            {error
              ? 'Could not load activity.'
              : events.length === 0
                ? 'No activity yet. Entries appear for shells started (or restarted) while the timeline is on.'
                : 'Nothing of this type yet.'}
          </div>
        )}
        {shown.map((e) => {
          const meta = TYPE_META[e.type];
          const Glyph = meta.icon;
          const open = e.filePath && onOpenFile ? () => onOpenFile(e.filePath!) : undefined;
          const title = e.tool ?? meta.label.replace(/s$/, '');
          return (
            <div
              key={e.id}
              role="listitem"
              className="argus-activity-row"
              data-type={e.type}
              data-clickable={open ? 'true' : undefined}
              tabIndex={open ? 0 : undefined}
              title={open ? `Open ${e.filePath}` : undefined}
              onClick={open}
              onKeyDown={open ? (ev) => { if (ev.key === 'Enter') open(); } : undefined}
            >
              <Icon icon={Glyph} size={13} strokeWidth={1.6} color="var(--fg-2)" style={{ flexShrink: 0, marginTop: 2 }} aria-label={meta.label} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--t-tiny)', color: 'var(--fg-1)', fontWeight: 500 }}>{title}</div>
                {e.summary && (
                  <div
                    style={{
                      fontFamily: e.type === 'tool' ? 'var(--font-mono)' : undefined,
                      fontSize: 'var(--t-tiny)',
                      color: open ? 'var(--accent)' : 'var(--fg-2)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {e.summary}
                  </div>
                )}
              </div>
              <time
                dateTime={new Date(e.at).toISOString()}
                title={new Date(e.at).toLocaleString()}
                style={{ flexShrink: 0, minWidth: 28, textAlign: 'right', fontSize: 'var(--t-micro)', color: 'var(--fg-3)', fontVariantNumeric: 'tabular-nums' }}
              >
                {relativeTime(e.at, now)}
              </time>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
