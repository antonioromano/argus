import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Landing } from './Landing.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const btn = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(label) || b.getAttribute('aria-label') === label);

describe('Landing — session templates promo', () => {
  it('offers one-click try and a dismiss on the empty landing', () => {
    const promo = { onTry: vi.fn(), onDismiss: vi.fn() };
    act(() => root.render(<Landing mode="empty" minimizedCount={0} onCreate={vi.fn()} onRestoreAll={vi.fn()} promo={promo} />));
    act(() => btn('Try session templates (beta)')!.click());
    expect(promo.onTry).toHaveBeenCalledTimes(1);
    act(() => btn('Hide this suggestion')!.click());
    expect(promo.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows nothing without a promo, or while sessions are only minimized', () => {
    act(() => root.render(<Landing mode="empty" minimizedCount={0} onCreate={vi.fn()} onRestoreAll={vi.fn()} />));
    expect(btn('Try session templates (beta)')).toBeUndefined();
    act(() => root.render(<Landing mode="all-minimized" minimizedCount={2} onCreate={vi.fn()} onRestoreAll={vi.fn()} promo={{ onTry: vi.fn(), onDismiss: vi.fn() }} />));
    expect(btn('Try session templates (beta)')).toBeUndefined();
  });
});
