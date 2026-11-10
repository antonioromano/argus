import { useMemo, useState, type ReactNode } from 'react';
import type { AgentRun, SessionInfo } from '@argus/shared';
import { Bot, ChevronLeft } from 'lucide-react';
import { EmptyState, ErrorState, Icon, LoadingState, Sheet } from '../../../components/primitives/index.js';
import { useAgentChat } from '../../../hooks/useAgentChat.js';
import { useNow } from '../../../hooks/useNow.js';
import { SuppressWhileMounted } from '../../../hooks/useOverlaySuppression.js';
import { ChatMessageItem } from './ChatMessageItem.js';
import { AgentMark } from './ChatAgentsStrip.js';
import type { ToolOpenState } from './ChatToolGroup.js';
import { agentRowParts } from './agentRow.js';
import { chatRows } from './toolSteps.js';

const STATUS_WORD: Record<AgentRun['status'], string> = { running: 'Running', finished: 'Finished', failed: 'Failed' };
const NO_AGENTS: AgentRun[] = [];
/** Desktop sheet width: room for tool steps and code blocks. */
const SHEET_WIDTH = 560;

/** The agents this one launched, one row each (no further nesting in this first version). */
function NestedAgents({ agents }: { agents: AgentRun[] }) {
  const now = useNow(1000, agents.some((a) => a.status === 'running'));
  if (agents.length === 0) return null;
  return (
    <div className="argus-agent-sheet-nested" data-testid="agent-sheet-nested">
      <div className="eyebrow argus-agent-sheet-nested-title">Launched agents</div>
      {agents.map((a) => {
        const { head, meta } = agentRowParts(a, now);
        return (
          <div key={a.id} className="argus-chat-agent-row argus-agent-sheet-nested-row" data-status={a.status}>
            <AgentMark status={a.status} />
            <span className="argus-chat-agent-head">{head}</span>
            <span className="argus-chat-agent-meta">{meta.map((m) => ` · ${m}`).join('')}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One agent of the session, read from its own transcript: what it was asked and what it
 * is doing, live while it runs. Read-only (no composer). A sheet over the desktop Focus,
 * a full screen on the phone (`fullScreen`, the Changes screen's pattern).
 */
export function ChatAgentSheet({ session, agent, onClose, fullScreen }: { session: SessionInfo; agent: AgentRun; onClose: () => void; fullScreen?: boolean }) {
  const { messages, loading, error } = useAgentChat(session.id, agent);
  const rows = useMemo(() => chatRows(messages), [messages]);
  const [toolStore] = useState<ToolOpenState>(() => new Set());
  const roster = session.agents ?? NO_AGENTS;
  const nested = useMemo(() => roster.filter((a) => a.parentAgentId === agent.id), [roster, agent.id]);
  const title = agent.description || agent.agentType;
  const subtitle = `${agent.agentType} · ${STATUS_WORD[agent.status]}`;

  let body: ReactNode;
  if (rows.length === 0 && loading) body = <LoadingState label="Reading the agent's transcript" />;
  else if (rows.length === 0 && error) body = <ErrorState error={error} fallbackTitle="Couldn't read the agent's transcript" />;
  else if (rows.length === 0) {
    body = <EmptyState icon={Bot} title="No transcript yet" hint="The agent's messages show here once it starts writing them." />;
  } else {
    body = (
      <div className="argus-agent-sheet-messages">
        {rows.map((m, i) => (
          <ChatMessageItem key={m.id} message={m} showRole={i === 0 || rows[i - 1].role !== m.role} toolStore={toolStore} />
        ))}
      </div>
    );
  }
  const content = (
    <>
      <NestedAgents agents={nested} />
      {body}
    </>
  );

  if (fullScreen) {
    return (
      <div
        className="argus-agent-screen"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="agent-sheet"
        style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-sheet)' }}
      >
        {/* Paints above --z-pop: nothing native may show through (the phone has none, but the contract holds). */}
        <SuppressWhileMounted target="all" />
        <div className="argus-agent-screen-bar">
          <button type="button" onClick={onClose} aria-label="Back" className="eyebrow argus-agent-screen-back">
            <Icon icon={ChevronLeft} size="md" /> BACK
          </button>
          <div className="argus-agent-screen-titles">
            <span className="argus-agent-screen-title">{title}</span>
            <span className="argus-agent-screen-subtitle">{subtitle}</span>
          </div>
        </div>
        <div className="argus-scroll argus-agent-screen-body">{content}</div>
      </div>
    );
  }
  return (
    <div data-testid="agent-sheet" style={{ display: 'contents' }}>
      <Sheet title={title} eyebrow="Agent" subtitle={subtitle} width={SHEET_WIDTH} onClose={onClose}>
        <div className="argus-agent-sheet-body">{content}</div>
      </Sheet>
    </div>
  );
}
