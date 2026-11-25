import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ColorThemePicker } from './ColorThemePicker.js';
import { PALETTE_IDS } from '../../../../tokens/palettes.js';

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

describe('ColorThemePicker', () => {
  it('shows every theme with both halves and marks the selected one', () => {
    act(() => root.render(<ColorThemePicker value="one" theme="dark" onChange={() => {}} />));
    const cards = Array.from(container.querySelectorAll<HTMLButtonElement>('.argus-theme-card'));
    expect(cards).toHaveLength(PALETTE_IDS.length);
    const one = cards.find((c) => c.textContent?.includes('One Dark'))!;
    expect(one.getAttribute('aria-pressed')).toBe('true');
    expect(one.textContent).toContain('One Light');
    expect(container.textContent).toContain('Darcula');
    expect(container.textContent).toContain('IntelliJ Light');
    // The half matching the current appearance is the marked one.
    expect(one.querySelector('[data-current]')?.textContent).toContain('One Dark');
  });

  it('reports the picked theme', () => {
    const onChange = vi.fn();
    act(() => root.render(<ColorThemePicker value="argus" theme="light" onChange={onChange} />));
    const card = Array.from(container.querySelectorAll<HTMLButtonElement>('.argus-theme-card'))
      .find((c) => c.textContent?.includes('Catppuccin'))!;
    act(() => card.click());
    expect(onChange).toHaveBeenCalledWith('catppuccin');
  });
});
