import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';
import { SessionCard } from './SessionCard.js';
import { TopToolbar } from './TopToolbar.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const session = (over: Partial<SessionInfo>): SessionInfo =>
  ({ id: 's1', name: 'api', folderPath: '/repo', agentType: 'claude', status: 'idle', flags: [], createdAt: new Date(0).toISOString(), ...over }) as SessionInfo;

describe('agents display state', () => {
  it('the session card reads as agents, not idle, while helpers run', () => {
    act(() => root.render(<SessionCard session={session({ agentsRunning: 2 })} />));
    const card = container.querySelector('.terminal-card')!;
    expect(card.getAttribute('data-status')).toBe('agents');
    expect(card.getAttribute('aria-label')).toContain('AGENTS');
    expect(card.textContent).toContain('Agents working…');
    expect(card.textContent).not.toContain('Idle');
  });

  it('an idle card with no helpers still reads Idle', () => {
    act(() => root.render(<SessionCard session={session({ agentsRunning: 0 })} />));
    expect(container.querySelector('.terminal-card')!.getAttribute('data-status')).toBe('idle');
    expect(container.textContent).toContain('Idle');
  });

  it('the toolbar bar announces the label its colour shows', () => {
    act(() => root.render(<TopToolbar sessions={[session({ agentsRunning: 1 })]} />));
    expect(container.querySelector('button[aria-label]')!.getAttribute('aria-label')).toBe('api · AGENTS');
  });
});
