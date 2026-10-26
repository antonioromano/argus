/* eslint-disable @typescript-eslint/no-explicit-any -- electron bridge shim */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo, SessionPr } from '@argus/shared';
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

describe('useNotifications — PR checks (C1)', () => {
  const PR = { number: 12, state: 'open' as const, url: 'https://github.com/o/r/pull/12', branch: 'feat/x', headSha: 'aaa1111' };
  const withPr = (id: string, pr: Partial<SessionPr> | null): SessionInfo =>
    ({ id, name: id.toUpperCase(), status: 'running', pr: pr ? { ...PR, ci: 'pending', ...pr } : undefined } as unknown as SessionInfo);

  function Host({ sessions, notifyOnPrChecks }: { sessions: SessionInfo[]; notifyOnPrChecks?: boolean }) {
    useNotifications({ sessions, enabled: true, notifyOnPrChecks, onFocusSession: () => {}, onSwitchToSessionsTab: () => {} });
    return null;
  }

  it('notifies when the checks go from pending to failed or passed, with the summary', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const r = mount();
    act(() => r.render(<Host sessions={[withPr('x', { ci: 'pending' })]} />));
    act(() => r.render(<Host sessions={[withPr('x', { ci: 'failure', checks: { counts: { passed: 2, failed: 1, pending: 0, skipped: 0 }, failed: [{ name: 'lint' }] } })]} />));
    expect(bridge.show).toHaveBeenCalledTimes(1);
    expect(bridge.show.mock.calls[0][0]).toMatchObject({ id: 'x', subtitle: 'X', body: 'CI: 1 failed · o/r#12' });

    // A new push runs again and passes.
    act(() => r.render(<Host sessions={[withPr('x', { ci: 'pending', headSha: 'bbb2222' })]} />));
    act(() => r.render(<Host sessions={[withPr('x', { ci: 'success', headSha: 'bbb2222' })]} />));
    expect(bridge.show).toHaveBeenCalledTimes(2);
    expect(bridge.show.mock.calls[1][0].body).toBe('CI: checks passing · o/r#12');
  });

  it('never on the first reading, a PR swap, or a settled → settled change', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const r = mount();
    act(() => r.render(<Host sessions={[withPr('x', { ci: 'success' })]} />));
    act(() => r.render(<Host sessions={[withPr('x', { ci: 'failure' })]} />));
    act(() => r.render(<Host sessions={[withPr('x', { ci: 'pending' })]} />));
    act(() => r.render(<Host sessions={[withPr('x', { ci: 'success', url: 'https://github.com/o/r/pull/13', number: 13 })]} />));
    expect(bridge.show).not.toHaveBeenCalled();
  });

  it('dedupes per PR + head SHA + outcome across sessions sharing the PR', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const r = mount();
    act(() => r.render(<Host sessions={[withPr('x', { ci: 'pending' }), withPr('y', { ci: 'pending' })]} />));
    act(() => r.render(<Host sessions={[withPr('x', { ci: 'success' }), withPr('y', { ci: 'success' })]} />));
    expect(bridge.show).toHaveBeenCalledTimes(1);
    // The same commit flapping back through pending to the same outcome stays quiet.
    act(() => r.render(<Host sessions={[withPr('x', { ci: 'pending' })]} />));
    act(() => r.render(<Host sessions={[withPr('x', { ci: 'success' })]} />));
    expect(bridge.show).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when switched off or while Argus is focused', () => {
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const r = mount();
    act(() => r.render(<Host notifyOnPrChecks={false} sessions={[withPr('x', { ci: 'pending' })]} />));
    act(() => r.render(<Host notifyOnPrChecks={false} sessions={[withPr('x', { ci: 'failure' })]} />));
    focus.mockReturnValue(true);
    act(() => r.render(<Host sessions={[withPr('x', { ci: 'pending', headSha: 'ccc3333' })]} />));
    act(() => r.render(<Host sessions={[withPr('x', { ci: 'failure', headSha: 'ccc3333' })]} />));
    expect(bridge.show).not.toHaveBeenCalled();
  });
});
