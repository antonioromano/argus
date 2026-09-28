/* eslint-disable @typescript-eslint/no-explicit-any -- React act environment */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TerminalChoice } from './TerminalChoice.js';
import { kindOf, settingsFor, TERMINAL_KINDS } from './terminalKind.js';

beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });

describe('terminalKind mapping', () => {
  it('round-trips every kind through the stored fields', () => {
    for (const k of TERMINAL_KINDS) {
      const { runMode, terminalEngine } = settingsFor(k);
      expect(kindOf(runMode, terminalEngine)).toBe(k);
    }
  });

  it('reads missing fields as Universal and any direct record as Native', () => {
    expect(kindOf(undefined, undefined)).toBe('universal');
    expect(kindOf('direct', 'native')).toBe('native');
  });
});

describe('TerminalChoice', () => {
  function render(value: 'universal' | 'advanced' | 'native', onChange = vi.fn()) {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    act(() => root.render(<TerminalChoice value={value} onChange={onChange} />));
    return { c, root, onChange };
  }

  it('marks the selected tab, shows its tagline, and reports a pick', () => {
    const { c, root, onChange } = render('universal');
    const tabs = [...c.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
    expect(tabs.map((t) => t.textContent)).toEqual(['Universal', 'AdvancedBeta', 'Native']);
    expect(tabs[0].getAttribute('aria-checked')).toBe('true');
    expect(c.textContent).toContain('Runs in the background. Works everywhere.');
    act(() => tabs[2].click());
    expect(onChange).toHaveBeenCalledWith('native');
    act(() => root.unmount());
  });

  it('keeps details closed by default and toggles them open and closed', () => {
    const { c, root } = render('native');
    const toggle = [...c.querySelectorAll('button')].find((b) => b.getAttribute('aria-expanded') !== null)!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(c.querySelector('table')).toBeNull();
    act(() => toggle.click());
    expect(c.querySelector('table')?.textContent).toContain('Conversation length');
    act(() => toggle.click());
    expect(c.querySelector('table')).toBeNull();
    act(() => root.unmount());
  });
});
