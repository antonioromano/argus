import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AgentRun } from '@argus/shared';
import { ChatAgentsStrip } from './ChatAgentsStrip.js';
import { AGENT_LINGER_MS, agentRowText, formatElapsed } from './agentRow.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const T0 = 1_700_000_000_000;

const agent = (over: Partial<AgentRun> = {}): AgentRun => ({
  id: 'a1',
  agentType: 'pre-push-reviewer',
  description: 'Delta review of fix commit',
  background: false,
  depth: 1,
  startedAt: T0,
  status: 'running',
  outputTokens: 125_000,
  ...over,
});

describe('formatElapsed', () => {
  it('reads seconds, then minutes, then hours', () => {
    expect(formatElapsed(33_000)).toBe('33 s');
    expect(formatElapsed(125_000)).toBe('2 min 05 s');
    expect(formatElapsed(3_720_000)).toBe('1 h 02 min');
  });
});

describe('agentRowText', () => {
  it('a running agent: type, description, live elapsed, tokens and its current step', () => {
    const a = agent({ lastStep: { name: 'Read', label: 'handler.ts', status: 'ok' } });
    expect(agentRowText(a, T0 + 33_000)).toBe('pre-push-reviewer · Delta review of fix commit · 33 s · 125k tokens · Read handler.ts');
  });

  it('a quiet agent ends with how long it has been silent', () => {
    const a = agent({ lastStep: { name: 'Read', label: 'handler.ts', status: 'ok' }, quietMinutes: 6 });
    expect(agentRowText(a, T0 + 33_000)).toMatch(/ · no output for 6 min$/);
  });

  it('a finished agent shows its run time, not a live tick', () => {
    const a = agent({ status: 'finished', finishedAt: T0 + 90_000 });
    expect(agentRowText(a, T0 + 600_000)).toBe('pre-push-reviewer · Delta review of fix commit · 1 min 30 s · 125k tokens');
  });

  it('a parent names its nested agents after the description', () => {
    expect(agentRowText(agent(), T0 + 5_000, 2)).toBe('pre-push-reviewer · Delta review of fix commit · +2 nested · 5 s · 125k tokens');
  });
});

describe('ChatAgentsStrip', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 10_000);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => { root = createRoot(container); });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
    vi.useRealTimers();
  });

  const render = (agents: AgentRun[], onOpen = vi.fn()) => {
    act(() => root.render(<ChatAgentsStrip agents={agents} onOpen={onOpen} />));
    return onOpen;
  };
  const rows = () => [...container.querySelectorAll<HTMLButtonElement>('.argus-chat-agent-row')];

  it('returns null with no agents', () => {
    render([]);
    expect(container.innerHTML).toBe('');
  });

  it('renders depth-1 rows only, with "+N nested" on the parent', () => {
    render([
      agent({ id: 'p' }),
      agent({ id: 'c1', depth: 2, parentAgentId: 'p', description: 'child one' }),
      agent({ id: 'c2', depth: 2, parentAgentId: 'p', description: 'child two' }),
      agent({ id: 'other', agentType: 'general-purpose', description: 'Other work' }),
    ]);
    expect(rows()).toHaveLength(2);
    expect(rows()[0].textContent).toContain('Delta review of fix commit · +2 nested');
    expect(rows()[1].textContent).not.toContain('nested');
    expect(container.textContent).not.toContain('child one');
  });

  it('ticks the elapsed time of a running row', () => {
    render([agent()]);
    expect(rows()[0].textContent).toContain('10 s');
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(rows()[0].textContent).toContain('13 s');
  });

  it('a row that finishes stays 10 s then leaves', () => {
    render([agent()]);
    render([agent({ status: 'finished', finishedAt: T0 + 12_000 })]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('[aria-label="Finished"]')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(AGENT_LINGER_MS - 100); });
    expect(rows()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(200); });
    expect(rows()).toHaveLength(0);
    expect(container.innerHTML).toBe('');
  });

  it('a row that drops out of the roster still lingers, then leaves', () => {
    render([agent()]);
    render([]);
    expect(rows()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(AGENT_LINGER_MS + 100); });
    expect(rows()).toHaveLength(0);
  });

  it('a failed row shows the error mark', () => {
    render([agent()]);
    render([agent({ status: 'failed', finishedAt: T0 + 12_000 })]);
    expect(rows()[0].querySelector('[aria-label="Failed"]')).not.toBeNull();
  });

  it('agents already finished when it mounts never show', () => {
    render([agent({ status: 'finished', finishedAt: T0 + 5_000 })]);
    expect(rows()).toHaveLength(0);
    expect(container.innerHTML).toBe('');
  });

  it('tap calls onOpen with the agent', () => {
    const a = agent();
    const onOpen = render([a]);
    act(() => rows()[0].click());
    expect(onOpen).toHaveBeenCalledWith(a);
  });
});
