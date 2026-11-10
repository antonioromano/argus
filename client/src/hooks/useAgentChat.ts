import { useEffect, useRef, useState } from 'react';
import type { AgentRun, AgentRunStatus, ChatMessage, SessionInfo } from '@argus/shared';
import { api } from '../services/api.js';

const NO_MESSAGES: ChatMessage[] = [];

/** A tool call still waiting for its result. */
function hasPendingTool(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.blocks.some((b) => b.kind === 'tool' && b.status === 'pending'));
}

/** `more` merged into `cur` by id: a known id is replaced in place, a new one appended. */
function mergeById(cur: ChatMessage[], more: ChatMessage[]): ChatMessage[] {
  if (more.length === 0) return cur;
  const at = new Map(cur.map((m, i) => [m.id, i]));
  const out = cur.slice();
  for (const m of more) {
    const i = at.get(m.id);
    if (i === undefined) {
      at.set(m.id, out.length);
      out.push(m);
    } else out[i] = m;
  }
  return out;
}

interface AgentChatState {
  messages: ChatMessage[];
  loading: boolean;
  error: unknown;
}

const EMPTY: AgentChatState = { messages: NO_MESSAGES, loading: false, error: null };

/** Step-driven re-reads of a running agent start at most this often; a later change gets a trailing read. */
export const AGENT_CHAT_READ_EVERY_MS = 2500;

/**
 * One agent's own transcript, for the agent sheet. Read once on open, then again when the
 * agent's roster entry changes status or last step (never on a token-only change), at most
 * once per AGENT_CHAT_READ_EVERY_MS with a trailing read so the last change is not lost, and
 * once more, at once, when it stops; no polling of its own. A read continues from the last
 * byte offset and merges by id, unless a tool step is still pending: a result past `after`
 * cannot fold into a call before it, so that read starts over from 0. A transcript the server
 * reports unavailable is not asked for again until the agent's status changes.
 */
export function useAgentChat(sessionId: string, agent: AgentRun | null): AgentChatState {
  const [state, setState] = useState<AgentChatState>(EMPTY);
  const live = useRef({
    key: '',
    gen: 0,
    offset: 0,
    messages: NO_MESSAGES,
    inFlight: false,
    again: false,
    /** The agent's status when the last read was asked for. */
    readStatus: undefined as AgentRunStatus | undefined,
    /** When the last read started (ms), for the throttle. */
    lastReadAt: -Infinity,
    /** The pending trailing read. */
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    /** The last answer said `available: false`. */
    unavailable: false,
  });
  const id = agent?.id ?? null;
  const status = agent?.status;
  const step = agent?.lastStep;
  const stepKey = step ? `${step.name}\u0000${step.label}\u0000${step.status}` : '';

  useEffect(() => {
    const l = live.current;
    const key = id ? `${sessionId}\u0000${id}` : '';
    const read = () => {
      if (l.timer) {
        clearTimeout(l.timer);
        l.timer = undefined;
      }
      if (l.inFlight) {
        l.again = true;
        return;
      }
      l.inFlight = true;
      l.lastReadAt = Date.now();
      const gen = l.gen;
      const full = l.offset === 0 || hasPendingTool(l.messages);
      api.getAgentChat(sessionId, id!, full ? 0 : l.offset).then(
        (r) => {
          if (gen !== l.gen) return;
          l.unavailable = !r.available;
          l.messages = full ? r.messages : mergeById(l.messages, r.messages);
          l.offset = r.offset;
          setState({ messages: l.messages, loading: false, error: null });
        },
        (err: unknown) => {
          if (gen !== l.gen) return;
          setState((s) => ({ ...s, loading: false, error: err }));
        },
      ).finally(() => {
        if (gen !== l.gen) return;
        l.inFlight = false;
        if (l.again) {
          l.again = false;
          read();
        }
      });
    };
    /** A read now if the last one is old enough, else one trailing read when it is. */
    const throttled = () => {
      const wait = l.lastReadAt + AGENT_CHAT_READ_EVERY_MS - Date.now();
      if (wait <= 0) read();
      else l.timer ??= setTimeout(() => {
        l.timer = undefined;
        read();
      }, wait);
    };
    if (key !== l.key) {
      // Another agent (or none): start over, and drop whatever the old one still answers.
      if (l.timer) clearTimeout(l.timer);
      Object.assign(l, {
        key, gen: l.gen + 1, offset: 0, messages: NO_MESSAGES, inFlight: false, again: false,
        readStatus: status, lastReadAt: -Infinity, timer: undefined, unavailable: false,
      });
      setState(id ? { messages: NO_MESSAGES, loading: true, error: null } : EMPTY);
      if (id) read();
      return;
    }
    if (!id) return;
    // Live while it runs, plus the read that sees it stop; a stopped agent's transcript is final.
    if (status !== 'running' && l.readStatus !== 'running') return;
    if (status !== l.readStatus) {
      l.readStatus = status;
      l.unavailable = false;
      read();
      return;
    }
    if (!l.unavailable) throttled();
  }, [sessionId, id, status, stepKey]);

  useEffect(() => {
    const l = live.current;
    return () => {
      if (l.timer) clearTimeout(l.timer);
      l.timer = undefined;
      l.gen += 1;
      l.key = '';
    };
  }, []);

  return state;
}

/**
 * The agent a host opened, kept current from the session's roster (a vanished one keeps
 * its last snapshot). It belongs to the session it was opened in: another session shows none.
 */
export function useOpenedAgent(session: SessionInfo): [AgentRun | null, (agent: AgentRun | null) => void] {
  const [opened, setOpened] = useState<{ sessionId: string; agent: AgentRun } | null>(null);
  const agent = opened && opened.sessionId === session.id
    ? session.agents?.find((a) => a.id === opened.agent.id) ?? opened.agent
    : null;
  const sessionId = session.id;
  return [agent, (a) => setOpened(a ? { sessionId, agent: a } : null)];
}
