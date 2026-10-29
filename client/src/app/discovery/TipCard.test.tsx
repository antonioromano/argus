import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TipCard } from './TipCard.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

describe('TipCard', () => {
  it('renders title, body and the live combo', () => {
    act(() => root.render(<TipCard title="Waiting inbox" body="Answer every waiting session from one list." combo="⌘⇧J" onClose={vi.fn()} />));
    expect(container.textContent).toContain('Waiting inbox');
    expect(container.textContent).toContain('Answer every waiting session');
    expect(container.querySelector('kbd')?.textContent).toBe('⌘⇧J');
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('primary closes as `action`, then runs', () => {
    const order: string[] = [];
    const onClose = vi.fn((r: string) => order.push(`close:${r}`));
    const run = vi.fn(() => { order.push('run'); });
    act(() => root.render(<TipCard title="t" body="b" primary={{ label: 'Show me', run }} onClose={onClose} />));
    act(() => button('Show me').click());
    expect(order).toEqual(['close:action', 'run']);
  });

  it('"Got it" and ✕ close as `dismiss`', () => {
    const onClose = vi.fn();
    act(() => root.render(<TipCard title="t" body="b" onClose={onClose} />));
    act(() => button('Got it').click());
    act(() => (container.querySelector('[aria-label="Dismiss"]') as HTMLElement).click());
    expect(onClose.mock.calls).toEqual([['dismiss'], ['dismiss']]);
  });

  it('"Turn off tips" dismisses and turns tips off', () => {
    const onClose = vi.fn();
    const onDisableAll = vi.fn();
    act(() => root.render(<TipCard title="t" body="b" onClose={onClose} onDisableAll={onDisableAll} />));
    act(() => button('Turn off tips').click());
    expect(onClose).toHaveBeenCalledWith('dismiss');
    expect(onDisableAll).toHaveBeenCalledTimes(1);
  });

  it('never moves focus on mount', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => root.render(<TipCard title="t" body="b" primary={{ label: 'Go', run: vi.fn() }} onClose={vi.fn()} />));
    expect(document.activeElement).toBe(input);
    input.remove();
  });
});
