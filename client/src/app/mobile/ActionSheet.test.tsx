import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';
import { ActionSheet } from './ActionSheet.js';

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

function render(s: SessionInfo, onOpen: (id: string, mode?: 'terminal' | 'chat') => void) {
  act(() => root.render(
    <ActionSheet session={s} isFavorite={false} onOpen={onOpen} onRestart={() => {}} onToggleFavorite={() => {}} onKill={() => {}} onClose={() => {}} />,
  ));
}

const row = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.startsWith(label)) ?? null;

describe('mobile ActionSheet view rows', () => {
  it('opens a Claude session as chat or as the terminal, naming the mode', () => {
    const onOpen = vi.fn();
    render(session(), onOpen);
    act(() => row('Open as chat')!.click());
    expect(onOpen).toHaveBeenLastCalledWith('s1', 'chat');
    act(() => row('Open terminal')!.click());
    expect(onOpen).toHaveBeenLastCalledWith('s1', 'terminal');
  });

  it('offers only the terminal for Codex and Gemini, with no mode', () => {
    for (const agentType of ['codex', 'gemini']) {
      const onOpen = vi.fn();
      render(session({ agentType }), onOpen);
      expect(row('Open as chat')).toBeNull();
      act(() => row('Open terminal')!.click());
      expect(onOpen).toHaveBeenLastCalledWith('s1');
    }
  });
});
