/* eslint-disable @typescript-eslint/no-explicit-any -- React act environment */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IntroSheet } from './IntroSheet.js';
import type { IntroFlow } from './intro.js';

let c: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
});
afterEach(() => { act(() => root.unmount()); c.remove(); });

function render(flow: IntroFlow, onDone = vi.fn()) {
  act(() => root.render(<IntroSheet flow={flow} version="0.24.0" config={{ defaultRunMode: 'persistent', defaultTerminalEngine: 'web' }} onDone={onDone} />));
  return onDone;
}
const button = (label: string) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === label);
  if (!b) throw new Error(`no "${label}" button`);
  return b as HTMLButtonElement;
};
const tab = (label: string) => [...document.querySelectorAll('[role="radio"]')].find((x) => x.textContent?.startsWith(label)) as HTMLButtonElement;

describe('IntroSheet', () => {
  it('walks What’s new step by step and saves the picked terminal as the default', () => {
    const onDone = render('whatsNew');
    expect(document.body.textContent).toContain('Pick your terminal');
    act(() => tab('Native').click());
    act(() => button('Next').click());
    expect(document.body.textContent).toContain('A clearer New shell sheet');
    act(() => button('Back').click());
    expect(document.body.textContent).toContain('Pick your terminal');
    act(() => button('Next').click());
    act(() => button('Next').click());
    act(() => button('Got it').click());
    expect(onDone).toHaveBeenCalledWith({ defaults: { runMode: 'direct', terminalEngine: 'web' }, openCreate: false });
  });

  it('does not change the default when the checkbox is cleared', () => {
    const onDone = render('whatsNew');
    act(() => (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    act(() => button('Next').click());
    act(() => button('Next').click());
    act(() => button('Got it').click());
    expect(onDone).toHaveBeenCalledWith({ defaults: undefined, openCreate: false });
  });

  it('Skip reports nothing to save', () => {
    const onDone = render('whatsNew');
    act(() => button('Skip').click());
    expect(onDone).toHaveBeenCalledWith({});
  });

  it('Welcome ends on New shell, which asks to open the create sheet', () => {
    const onDone = render('welcome');
    expect(document.body.textContent).toContain('Welcome to Argus');
    act(() => button('Next').click());
    act(() => button('Next').click());
    act(() => button('New shell').click());
    expect(onDone).toHaveBeenCalledWith({ defaults: { runMode: 'persistent', terminalEngine: 'web' }, openCreate: true });
  });
});
