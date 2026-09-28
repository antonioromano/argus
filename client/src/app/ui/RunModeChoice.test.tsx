/* eslint-disable @typescript-eslint/no-explicit-any -- React act environment */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RunModeChoice } from './RunModeChoice.js';

beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });

describe('RunModeChoice', () => {
  it('shows both modes with the selected one pressed, and reports a change', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    const onChange = vi.fn();
    act(() => root.render(<RunModeChoice value="persistent" onChange={onChange} />));
    const buttons = [...c.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Persistent'), expect.stringContaining('Direct')]));
    act(() => buttons.find((b) => b.textContent?.includes('Direct'))!.click());
    expect(onChange).toHaveBeenCalledWith('direct');
    act(() => root.unmount());
  });
});
