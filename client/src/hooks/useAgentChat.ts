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

/**
 * One agent's own transcript, for the agent sheet. Read once on open, then again each
 * time the agent's roster entry changes while it runs (tokens, last step, status), with
 * one last read when it stops; no polling of its own. A read continues from the last
 * byte offset and merges by id, unless a tool step is still pending: a result past
 * `after` cannot fold into a call before it, so that read starts over from 0.
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
  });
  const id = agent?.id ?? null;
  const status = agent?.status;
  const tokens = agent?.outputTokens;
  const step = agent?.lastStep;
  const stepKey = step ? `${step.name}\u0000${step.label}\u0000${step.status}` : '';

  useEffect(() => {
    const l = live.current;
    const key = id ? `${sessionId}\u0000${id}` : '';
    const read = () => {
      if (l.inFlight) {
        l.again = true;
        return;
      }
      l.inFlight = true;
      const gen = l.gen;
      const full = l.offset === 0 || hasPendingTool(l.messages);
      api.getAgentChat(sessionId, id!, full ? 0 : l.offset).then(
        (r) => {
          if (gen !== l.gen) return;
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
    if (key !== l.key) {
      // Another agent (or none): start over, and drop whatever the old one still answers.
      Object.assign(l, { key, gen: l.gen + 1, offset: 0, messages: NO_MESSAGES, inFlight: false, again: false, readStatus: status });
      setState(id ? { messages: NO_MESSAGES, loading: true, error: null } : EMPTY);
      if (id) read();
      return;
    }
    if (!id) return;
    // Live while it runs, plus the read that sees it stop; a stopped agent's transcript is final.
    if (status !== 'running' && l.readStatus !== 'running') return;
    l.readStatus = status;
    read();
  }, [sessionId, id, status, tokens, stepKey]);

  useEffect(() => {
    const l = live.current;
    return () => {
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
