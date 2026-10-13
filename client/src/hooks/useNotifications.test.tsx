/* eslint-disable @typescript-eslint/no-explicit-any -- electron bridge shim */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';
import { useNotifications } from './useNotifications.js';

const bridge = { show: vi.fn(), close: vi.fn(), onClick: vi.fn(() => () => {}) };

const s = (status: string): SessionInfo => ({ id: 'x', name: 'X', status, lastPrompt: 'Proceed?' } as unknown as SessionInfo);

// One Host per Electron window. Each window's hook sees every session.
function Window({ sessions, owns }: { sessions: SessionInfo[]; owns?: (id: string) => boolean }) {
  useNotifications({ sessions, enabled: true, onFocusSession: () => {}, onSwitchToSessionsTab: () => {}, ownsSession: owns });
  return null;
}

let roots: Root[] = [];
function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  let root!: Root;
  act(() => { root = createRoot(el); });
  roots.push(root);
  return root;
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (window as any).electronNotifications = bridge;
  vi.clearAllMocks();
});

afterEach(() => {
  for (const r of roots) act(() => r.unmount());
  roots = [];
  vi.restoreAllMocks();
  delete (window as any).electronNotifications;
});

describe('useNotifications — multi-window ownership', () => {
  it('only the owning window notifies; a background non-owner stays quiet', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const main = mount();
    const second = mount();
    // Session x is owned by the second window (windows.json assignment).
    const ownedBySecond = { main: () => false, second: () => true };
    act(() => { main.render(<Window sessions={[s('running')]} owns={ownedBySecond.main} />); second.render(<Window sessions={[s('running')]} owns={ownedBySecond.second} />); });
    act(() => { main.render(<Window sessions={[s('waiting')]} owns={ownedBySecond.main} />); second.render(<Window sessions={[s('waiting')]} owns={ownedBySecond.second} />); });
    expect(bridge.show).toHaveBeenCalledTimes(1);
  });

  it('a non-owning window never notifies, even while unfocused', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const r = mount();
    act(() => r.render(<Window sessions={[s('running')]} owns={() => false} />));
    act(() => r.render(<Window sessions={[s('waiting')]} owns={() => false} />));
    expect(bridge.show).not.toHaveBeenCalled();
  });

  it('the owning window notifies only when it is not focused', () => {
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const r = mount();
    act(() => r.render(<Window sessions={[s('running')]} owns={() => true} />));
    act(() => r.render(<Window sessions={[s('waiting')]} owns={() => true} />));
    expect(bridge.show).not.toHaveBeenCalled();

    focus.mockReturnValue(false);
    act(() => r.render(<Window sessions={[s('running')]} owns={() => true} />));
    act(() => r.render(<Window sessions={[s('waiting')]} owns={() => true} />));
    expect(bridge.show).toHaveBeenCalledTimes(1);
    expect(bridge.show.mock.calls[0][0]).toMatchObject({ id: 'x', subtitle: 'X', body: 'Proceed?' });
  });

  it('single-window default (no ownsSession) still notifies', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const r = mount();
    act(() => r.render(<Window sessions={[s('running')]} />));
    act(() => r.render(<Window sessions={[s('waiting')]} />));
    expect(bridge.show).toHaveBeenCalledTimes(1);
  });
});
