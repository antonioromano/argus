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

const checkbox = (flag: string) => document.querySelector(`[data-testid="intro-turn-on-${flag}"]`) as HTMLInputElement | null;
const title = () => document.body.textContent ?? '';
const next = (n = 1) => { for (let i = 0; i < n; i++) act(() => button('Next').click()); };

const FEATURE_TITLES = ['Worktree lifecycle', 'Activity timeline', 'Session templates', 'Agent handoff', 'Session chains'];

describe('IntroSheet — What’s new', () => {
  it('walks intro → one slide per beta feature in order → summary, with Back', () => {
    render('whatsNew');
    expect(title()).toContain('Plan usage in the shell header');
    expect(title()).toContain('ctx 47% · plan 20% · ↻ 2h19m');
    expect(document.querySelector('[aria-label="Step 1 of 8"]')).toBeTruthy();
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    next();
    expect(title()).toContain('Five beta features to try');
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    for (const t of FEATURE_TITLES) {
      next();
      expect(title()).toContain(t);
      expect(title()).toContain(`Turn on ${t}`);
    }
    act(() => button('Back').click());
    expect(title()).toContain('Turn on Agent handoff');
    next(2);
    expect(title()).toContain('You’re set');
    expect(button('Done')).toBeTruthy();
    // The terminal-kinds step is gone from What's new.
    expect(title()).not.toContain('Pick your terminal');
  });

  it('starts with every Turn on box unchecked and keeps ticks across Back/Next', () => {
    render('whatsNew');
    next(); // past the Usage meter slide
    next();
    const box = checkbox('betaWorktreeLifecycle')!;
    expect(box.checked).toBe(false);
    act(() => box.click());
    next();
    expect(checkbox('betaActivityTimeline')!.checked).toBe(false);
    act(() => button('Back').click());
    expect(checkbox('betaWorktreeLifecycle')!.checked).toBe(true);
  });

  it('Done saves only the ticked flags, and the summary lists them', () => {
    const onDone = render('whatsNew');
    next(); // past the Usage meter slide
    next(2); // Activity timeline
    act(() => checkbox('betaActivityTimeline')!.click());
    next(3); // Session chains
    act(() => checkbox('betaSessionChains')!.click());
    next();
    const summary = document.querySelector('[data-testid="intro-summary"]')!.textContent;
    expect(summary).toContain('Activity timeline');
    expect(summary).toContain('Session chains');
    expect(summary).not.toContain('Worktree lifecycle');
    expect(summary).not.toContain('Nothing turned on');
    act(() => button('Done').click());
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({ betaFlags: { betaActivityTimeline: true, betaSessionChains: true } });
  });

  it('a box ticked then cleared is not saved', () => {
    const onDone = render('whatsNew');
    next(); // past the Usage meter slide
    next();
    act(() => checkbox('betaWorktreeLifecycle')!.click());
    act(() => checkbox('betaWorktreeLifecycle')!.click());
    next(5);
    expect(document.querySelector('[data-testid="intro-summary"]')!.textContent).toContain('Nothing turned on');
    act(() => button('Done').click());
    expect(onDone).toHaveBeenCalledWith({ betaFlags: {} });
  });

  it('Skip turns nothing on, even with boxes ticked', () => {
    const onDone = render('whatsNew');
    next(); // past the Usage meter slide
    next();
    act(() => checkbox('betaWorktreeLifecycle')!.click());
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
