import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChainChip } from './ChainChip.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const chip = () => container.querySelector('[data-testid="chain-chip"]');

describe('ChainChip (beta F13)', () => {
  it('renders nothing while the flag is off (no count passed) or there are no chains', () => {
    act(() => { root.render(<ChainChip />); });
    expect(chip()).toBeNull();
    act(() => { root.render(<ChainChip count={0} />); });
    expect(chip()).toBeNull();
  });

  it('shows ⛓ and the count of chains from the shell', () => {
    act(() => { root.render(<ChainChip count={2} />); });
    expect(chip()?.textContent).toBe('⛓ 2');
    expect(chip()?.getAttribute('aria-label')).toBe('2 chains');
    expect(chip()?.className).toBe('argus-tile-chain');
  });
});
