import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AgentsChip } from './AgentsChip.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const chip = () => container.querySelector('[data-testid="agents-chip"]');

describe('AgentsChip', () => {
  it('renders nothing for 0', () => {
    act(() => { root.render(<AgentsChip count={0} />); });
    expect(chip()).toBeNull();
  });

  it('reads "1 agent" and "3 agents"', () => {
    act(() => { root.render(<AgentsChip count={1} />); });
    expect(chip()?.textContent).toBe('1 agent');
    expect(chip()?.getAttribute('title')).toBe('Running agents');
    expect(chip()?.tagName).toBe('SPAN');
    act(() => { root.render(<AgentsChip count={3} />); });
    expect(chip()?.textContent).toBe('3 agents');
  });

  it('is a button that calls onClick', () => {
    const onClick = vi.fn();
    act(() => { root.render(<AgentsChip count={2} onClick={onClick} />); });
    expect(chip()?.tagName).toBe('BUTTON');
    act(() => { (chip() as HTMLElement).click(); });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
