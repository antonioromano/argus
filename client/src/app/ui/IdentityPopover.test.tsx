import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IdentityPopover } from './IdentityPopover.js';

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

function render(session = { id: 's1', color: undefined as string | undefined, emoji: undefined as string | undefined }) {
  const onSave = vi.fn(async () => ({}));
  const onClose = vi.fn();
  act(() => root.render(<IdentityPopover session={session} x={10} y={10} onSave={onSave} onClose={onClose} />));
  return { onSave, onClose };
}

// Matched in JS: jsdom's selector engine trips on astral-plane attribute values.
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === label)!;
const input = () => container.querySelector<HTMLInputElement>('input[aria-label="Custom emoji"]')!;

function type(value: string) {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
}

describe('IdentityPopover', () => {
  it('a swatch saves the colour key and marks itself pressed', () => {
    const { onSave } = render();
    act(() => button('Teal').click());
    expect(onSave).toHaveBeenCalledWith('s1', { color: 'teal' });
    expect(button('Teal').getAttribute('aria-pressed')).toBe('true');
  });

  it('a curated emoji saves it', () => {
    const { onSave } = render();
    act(() => button('🦊').click());
    expect(onSave).toHaveBeenCalledWith('s1', { emoji: '🦊' });
  });

  it('two emoji in the field show an inline error and send nothing', () => {
    const { onSave } = render();
    type('🦊🦊');
    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Enter one emoji');
  });

  it('one emoji in the field saves it', () => {
    const { onSave } = render();
    type('👩‍💻');
    expect(onSave).toHaveBeenCalledWith('s1', { emoji: '👩‍💻' });
  });

  it('Clear removes both, and is disabled when there is nothing to clear', () => {
    const empty = render();
    const clear = () => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Clear')!;
    expect(clear().disabled).toBe(true);
    act(() => root.unmount());
    root = createRoot(container);

    const { onSave } = render({ id: 's1', color: 'teal', emoji: '🦊' });
    act(() => clear().click());
    expect(onSave).toHaveBeenCalledWith('s1', { color: null, emoji: null });
    expect(empty.onSave).not.toHaveBeenCalled();
  });

  it('Escape closes', () => {
    const { onClose } = render();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onClose).toHaveBeenCalled();
  });

  it('a server refusal shows inline', async () => {
    const onSave = vi.fn(async () => { throw new Error('emoji must be a single emoji'); });
    act(() => root.render(<IdentityPopover session={{ id: 's1' }} x={0} y={0} onSave={onSave} onClose={() => {}} />));
    await act(async () => { button('🚀').click(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('emoji must be a single emoji');
  });
});
