import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';
import { WaitingInbox } from './WaitingInbox.js';

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

const s = (id: string, over: Partial<SessionInfo> = {}): SessionInfo => ({
  id, name: `shell-${id}`, folderPath: `/r/${id}`, status: 'waiting', createdAt: '', agentType: 'claude', flags: [], ...over,
});
const key = (k: string) => act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });

function render(sessions: SessionInfo[], handlers: Partial<{ onJump: (id: string) => void; onSendKey: (id: string, k: string) => void; onClose: () => void }> = {}) {
  const props = { onJump: vi.fn(), onSendKey: vi.fn(), onClose: vi.fn(), ...handlers };
  act(() => root.render(<WaitingInbox sessions={sessions} {...props} />));
  return props;
}

describe('WaitingInbox', () => {
  it('lists only waiting shells with their prompt', () => {
    render([s('a', { lastPrompt: 'Run npm test?', waitingSince: Date.now() - 5000 }), s('b', { status: 'running' })]);
    const rows = container.querySelectorAll('[role="option"]');
    expect(rows.length).toBe(1);
    expect(rows[0]!.textContent).toContain('shell-a');
    expect(rows[0]!.textContent).toContain('Run npm test?');
    expect(rows[0]!.textContent).toContain('5s');
  });

  it('arrow keys move, Enter jumps to the selected shell', () => {
    const p = render([s('a', { waitingSince: 1 }), s('b', { waitingSince: 2 })]);
    key('ArrowDown');
    key('Enter');
    expect(p.onJump).toHaveBeenCalledWith('b');
  });

  it('a digit answers the menu when its options were read, and does nothing otherwise', () => {
    const p = render([
      s('a', { waitingSince: 1, promptOptions: [{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }] }),
      s('b', { waitingSince: 2 }),
    ]);
    key('2');
    expect(p.onSendKey).toHaveBeenCalledWith('a', '2');
    key('9');
    expect(p.onSendKey).toHaveBeenCalledTimes(1);
    key('ArrowDown');
    key('1');
    expect(p.onSendKey).toHaveBeenCalledTimes(1);
  });

  it('keeps the selection on the same shell when another row disappears', () => {
    const p = render([s('a', { waitingSince: 1 }), s('b', { waitingSince: 2 })]);
    key('ArrowDown'); // b
    act(() => root.render(<WaitingInbox sessions={[s('a', { status: 'running' }), s('b', { waitingSince: 2 })]} {...p} />));
    key('Enter');
    expect(p.onJump).toHaveBeenCalledWith('b');
  });

  it('shows an empty state', () => {
    render([]);
    expect(container.textContent).toContain('Nothing is waiting on you.');
  });

  it('Space marks shells and B opens broadcast for the marked ones (else the selected one)', () => {
    const onBroadcast = vi.fn();
    const props = { onJump: vi.fn(), onSendKey: vi.fn(), onClose: vi.fn(), onBroadcast };
    const list = [s('a', { waitingSince: 1 }), s('b', { waitingSince: 2 }), s('c', { waitingSince: 3 })];
    act(() => root.render(<WaitingInbox sessions={list} {...props} />));
    key('b');
    expect(onBroadcast).toHaveBeenLastCalledWith(['a']);
    key(' ');
    key('ArrowDown');
    key('ArrowDown');
    key(' ');
    key('B');
    expect(onBroadcast).toHaveBeenLastCalledWith(['a', 'c']);
  });
});
