import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentRun } from '@argus/shared';
import { Check } from 'lucide-react';
import { Icon } from '../../../components/primitives/index.js';
import { useNow } from '../../../hooks/useNow.js';
import { StatusMark } from './ChatToolGroup.js';
import { AGENT_LINGER_MS, agentRowParts, followRoster, nestedCounts } from './agentRow.js';

export function AgentMark({ status }: { status: AgentRun['status'] }) {
  if (status === 'running') return <StatusMark status="pending" />;
  if (status === 'failed') return <StatusMark status="error" />;
  return <Icon icon={Check} size="sm" className="argus-chat-tool-mark is-done" aria-label="Finished" />;
}

/**
 * The session's running agents, between the messages and the composer (where
 * Claude's own terminal UI lists them). Only top-level agents get a row; a
 * parent counts its nested ones. A row that stops stays AGENT_LINGER_MS with
 * its end mark, then leaves; agents already done when the strip mounts never show.
 */
export function ChatAgentsStrip({ agents, onOpen }: { agents: AgentRun[]; onOpen: (agent: AgentRun) => void }) {
  const [tracked, setTracked] = useState(() => followRoster(new Map(), agents));
  // Follow the roster during render, so a row that just stopped never blinks out.
  const [seen, setSeen] = useState(agents);
  if (agents !== seen) {
    setSeen(agents);
    setTracked((prev) => followRoster(prev, agents));
  }

  // One linger timer per stopped row; it drops the row when it fires.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const live = timers.current;
    for (const [id, t] of tracked) {
      if (!t.stopped || live.has(id)) continue;
      live.set(
        id,
        setTimeout(() => {
          live.delete(id);
          setTracked((prev) => {
            if (!prev.get(id)?.stopped) return prev;
            const next = new Map(prev);
            next.delete(id);
            return next;
          });
        }, AGENT_LINGER_MS),
      );
    }
    // A row that runs again keeps its place: no timer.
    for (const [id, handle] of live) {
      if (tracked.get(id)?.stopped) continue;
      clearTimeout(handle);
      live.delete(id);
    }
  }, [tracked]);
  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const handle of live.values()) clearTimeout(handle);
      live.clear();
    };
  }, []);

  const rows = useMemo(() => {
    const ids = new Set(agents.map((a) => a.id));
    const shown = agents.filter((a) => a.depth === 1 && (a.status === 'running' || tracked.has(a.id)));
    // Rows that left the roster linger as they were last seen.
    for (const [id, t] of tracked) if (!ids.has(id)) shown.push(t.agent);
    return shown.sort((x, y) => x.startedAt - y.startedAt);
  }, [agents, tracked]);
  const nested = useMemo(() => nestedCounts(agents), [agents]);

  const now = useNow(1000, rows.some((a) => a.status === 'running'));

  if (rows.length === 0) return null;
  return (
    <div className="argus-chat-agents">
      {rows.map((a) => {
        const { head, meta } = agentRowParts(a, now, nested.get(a.id) ?? 0);
        return (
          <button key={a.id} type="button" className="argus-chat-agent-row" data-status={a.status} onClick={() => onOpen(a)}>
            <AgentMark status={a.status} />
            <span className="argus-chat-agent-head">{head}</span>
            <span className="argus-chat-agent-meta">{meta.map((m) => ` · ${m}`).join('')}</span>
          </button>
        );
      })}
    </div>
  );
}
