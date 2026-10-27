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

function render(flow: IntroFlow, onDone = vi.fn(), defaultSessionView: 'terminal' | 'chat' = 'terminal') {
  act(() => root.render(<IntroSheet flow={flow} version="0.24.0" config={{ defaultRunMode: 'persistent', defaultTerminalEngine: 'web', defaultSessionView }} onDone={onDone} />));
  return onDone;
}
const button = (label: string) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === label);
  if (!b) throw new Error(`no "${label}" button`);
  return b as HTMLButtonElement;
};
const tab = (label: string) => [...document.querySelectorAll('[role="radio"]')].find((x) => x.textContent?.startsWith(label)) as HTMLButtonElement;

const chatBox = () => {
  const label = [...document.querySelectorAll('label')].find((l) => l.textContent?.includes('Open Claude shells in Chat by default'));
  if (!label) throw new Error('no Chat by default checkbox');
  return label.querySelector('input[type="checkbox"]') as HTMLInputElement;
};
const title = () => document.body.textContent ?? '';
const next = (n = 1) => { for (let i = 0; i < n; i++) act(() => button('Next').click()); };

describe('IntroSheet — What’s new', () => {
  it('walks the five release slides, without the terminal step or beta opt-ins', () => {
    render('whatsNew');
    expect(title()).toContain('Chat view for Claude shells');
    expect(document.querySelector('img[alt^="A Claude shell in Focus"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Step 1 of 5"]')).toBeTruthy();
    expect(chatBox().checked).toBe(false);
    next();
    expect(title()).toContain('Session Inspector');
    expect(title()).toContain('⌘I');
    next();
    expect(title()).toContain('Your session’s pull requests');
    expect(title()).toContain('Mark ready');
    next();
    expect(title()).toContain('Find in Files, highlighted everywhere');
    next();
    expect(title()).toContain('An icon for every macOS style');
    for (const style of ['Default', 'Dark', 'Tinted', 'Clear']) expect(document.querySelector(`img[alt="Argus icon, ${style} style"]`)).toBeTruthy();
    expect(document.querySelector('[aria-label="Step 5 of 5"]')).toBeTruthy();
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    expect(title()).not.toContain('Pick your terminal');
    expect(() => button('Next')).toThrow();
  });

  it('Done and Skip both close it with nothing to apply', () => {
    const onDone = render('whatsNew');
    next(4);
    act(() => button('Done').click());
    expect(onDone).toHaveBeenCalledWith({});
    const onSkip = render('whatsNew');
    act(() => button('Skip').click());
    expect(onSkip).toHaveBeenCalledWith({});
  });
});

describe('IntroSheet — Chat by default', () => {
  it('Done with the box ticked turns on Chat by default', () => {
    const onDone = render('whatsNew');
    act(() => chatBox().click());
    next(4);
    act(() => button('Done').click());
    expect(onDone).toHaveBeenCalledWith({ defaultSessionView: 'chat' });
  });

  it('Skip with the box ticked turns it on too', () => {
    const onDone = render('whatsNew');
    act(() => chatBox().click());
    act(() => button('Skip').click());
    expect(onDone).toHaveBeenCalledWith({ defaultSessionView: 'chat' });
  });

  it('shows the box ticked and locked when Chat is already the default, and saves nothing', () => {
    const onDone = render('whatsNew', vi.fn(), 'chat');
    expect(chatBox().checked).toBe(true);
    expect(chatBox().disabled).toBe(true);
    act(() => button('Skip').click());
    expect(onDone).toHaveBeenCalledWith({});
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
