import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';
import { Sessions } from './Sessions.js';

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

function session(over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 's1', name: 'api', folderPath: '/repo/api', status: 'idle',
    createdAt: new Date().toISOString(), agentType: 'claude', flags: [], ...over,
  };
}

function render(sessions: SessionInfo[]) {
  act(() => root.render(
    <Sessions
      sessions={sessions}
      grouped={{ favorites: null, groups: [], others: sessions, othersColor: null }}
      publicUrl={null}
      onSelect={() => {}}
      onAction={() => {}}
      onSpawnFavorite={() => {}}
      onCreate={() => {}}
    />,
  ));
}

describe('mobile Sessions row (plan 009 M1)', () => {
  it('shows the identity emoji and colour edge like the desktop', () => {
    render([session({ emoji: '🦊', color: 'teal' })]);
    expect(container.querySelector('.argus-identity-emoji')?.textContent).toBe('🦊');
    expect(container.querySelector('[data-identity-edge="teal"]')).not.toBeNull();
  });

  it('falls back to the folder name when the session has no name', () => {
    render([session({ name: '' })]);
    expect(container.querySelector('.mobile-list-row')?.textContent).toContain('api');
    expect(container.querySelector('button[aria-label="Actions for api"]')).not.toBeNull();
  });

  it('shows the same PR and stale chips as the tile header, and how long it has waited', () => {
    render([session({
      status: 'waiting',
      waitingSince: Date.now() - 125_000,
      worktreeStaleDays: 20,
      pr: { number: 12, url: 'https://github.com/o/r/pull/12', state: 'open', ci: 'none', branch: 'feat' } as SessionInfo['pr'],
    })]);
    expect(container.querySelector('.mobile-row-chips')).not.toBeNull();
    expect(container.querySelector('[data-testid="stale-chip"]')).not.toBeNull();
    expect(container.textContent).toContain('waiting 2m');
  });

  it('renders no chip row for a session with nothing to show', () => {
    render([session()]);
    expect(container.querySelector('.mobile-row-chips')).toBeNull();
  });
});

