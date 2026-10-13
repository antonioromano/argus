import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';
import { BroadcastSheet } from './BroadcastSheet.js';

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

const s = (id: string, status: SessionInfo['status'] = 'idle'): SessionInfo => ({
  id, name: `shell-${id}`, folderPath: `/r/${id}`, status, createdAt: '', agentType: 'claude', flags: [],
});

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;

function type(value: string) {
  const input = document.querySelector('input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('BroadcastSheet', () => {
  it('lists only live shells, preselects the given ones, and gates Review', () => {
    act(() => root.render(
      <BroadcastSheet sessions={[s('a'), s('b'), s('x', 'exited')]} initialSelected={['a']} onSend={vi.fn()} onSent={vi.fn()} onClose={vi.fn()} />,
    ));
    expect(document.querySelectorAll('.argus-broadcast-row').length).toBe(2);
    expect(document.body.textContent).toContain('1 OF 2');
    // Enter is on by default, so an empty line is still a valid send (just Enter).
    expect(button('Review (1)')!.disabled).toBe(false);
  });

  it('confirms the exact text and every target before sending', async () => {
    const onSend = vi.fn(async () => ({ ok: true as const, sent: 2, skipped: 0 }));
    const onSent = vi.fn();
    act(() => root.render(
      <BroadcastSheet sessions={[s('a'), s('b')]} initialSelected={[]} onSend={onSend} onSent={onSent} onClose={vi.fn()} />,
    ));
    act(() => (document.querySelectorAll('.argus-broadcast-row')[0] as HTMLElement).click());
    act(() => (document.querySelectorAll('.argus-broadcast-row')[1] as HTMLElement).click());
    type('/compact');
    act(() => button('Review (2)')!.click());

    expect(document.querySelector('[data-testid="broadcast-preview"]')!.textContent).toContain('/compact');
    const targets = document.querySelector('[data-testid="broadcast-targets"]')!.textContent;
    expect(targets).toContain('shell-a');
    expect(targets).toContain('shell-b');
    expect(onSend).not.toHaveBeenCalled();

    await act(async () => { button('Send to 2 shells')!.click(); });
    expect(onSend).toHaveBeenCalledWith({ sessionIds: ['a', 'b'], text: '/compact', enter: true });
    expect(onSent).toHaveBeenCalledWith({ ok: true, sent: 2, skipped: 0 });
  });

  it('shows the server refusal and stays open', async () => {
    const onSend = vi.fn(async () => ({ ok: false as const, error: 'Too many broadcasts — wait a few seconds' }));
    const onSent = vi.fn();
    act(() => root.render(
      <BroadcastSheet sessions={[s('a')]} initialSelected={['a']} onSend={onSend} onSent={onSent} onClose={vi.fn()} />,
    ));
    type('y');
    act(() => button('Review (1)')!.click());
    await act(async () => { button('Send to 1 shell')!.click(); });
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('Too many broadcasts');
    expect(onSent).not.toHaveBeenCalled();
  });

  it('blocks control characters before they reach the server', () => {
    act(() => root.render(
      <BroadcastSheet sessions={[s('a')]} initialSelected={['a']} onSend={vi.fn()} onSent={vi.fn()} onClose={vi.fn()} />,
    ));
    type('\x1b[2J'); // a single-line input already drops pasted newlines
    expect(button('Review (1)')!.disabled).toBe(true);
    expect(document.body.textContent).toContain('One line only');
  });
});
