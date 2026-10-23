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

const title = () => document.body.textContent ?? '';
const next = (n = 1) => { for (let i = 0; i < n; i++) act(() => button('Next').click()); };

describe('IntroSheet — What’s new', () => {
  it('shows only the Chat view slide, without the terminal step or beta opt-ins', () => {
    render('whatsNew');
    expect(title()).toContain('Chat view for Claude shells');
    expect(document.querySelector('img[alt^="A Claude shell in Focus"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Step 1 of 1"]')).toBeTruthy();
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    expect(title()).not.toContain('Pick your terminal');
    expect(title()).not.toContain('Plan usage in the shell header');
  });

  it('Done and Skip both close it with nothing to apply', () => {
    const onDone = render('whatsNew');
    act(() => button('Done').click());
    expect(onDone).toHaveBeenCalledWith({});
    const onSkip = render('whatsNew');
    act(() => button('Skip').click());
    expect(onSkip).toHaveBeenCalledWith({});
  });
});

describe('IntroSheet — Welcome', () => {
  it('keeps the terminal step and saves the picked terminal as the default', () => {
    const onDone = render('welcome');
    expect(title()).toContain('Welcome to Argus');
    next();
    expect(title()).toContain('Pick your terminal');
    act(() => tab('Native').click());
    next();
    act(() => button('New shell').click());
    expect(onDone).toHaveBeenCalledWith({ defaults: { runMode: 'direct', terminalEngine: 'web' }, openCreate: true });
  });

  it('does not change the default when the checkbox is cleared', () => {
    const onDone = render('welcome');
    next();
    act(() => (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    next();
    act(() => button('New shell').click());
    expect(onDone).toHaveBeenCalledWith({ defaults: undefined, openCreate: true });
  });

  it('ends on New shell, which asks to open the create sheet', () => {
    const onDone = render('welcome');
    next(2);
    act(() => button('New shell').click());
    expect(onDone).toHaveBeenCalledWith({ defaults: { runMode: 'persistent', terminalEngine: 'web' }, openCreate: true });
  });
});
