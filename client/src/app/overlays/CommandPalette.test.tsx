import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';
import { CommandPalette } from './CommandPalette.js';
import type { Command } from '../../commands/types.js';
import { createFrecency, type FrecencyStorage } from '../../commands/frecency.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock('../../services/api.js', () => ({ api: { searchFiles: vi.fn(async () => ({ results: [] })), getFileContent: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => {}; // jsdom has no layout
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const session: SessionInfo = { id: 's1', name: 'api', folderPath: '/r/api', status: 'idle', createdAt: '', agentType: 'claude', flags: [] };
const cmd = (id: string, title: string, over: Partial<Command> = {}): Command => ({
  id, title, category: 'View', source: 'test', run: vi.fn(), ...over,
});
const key = (k: string) => act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });

function memoryFrecency(seed: Record<string, number[]> = {}) {
  const data = new Map<string, string>([['argus.palette.frecency.v1', JSON.stringify(seed)]]);
  const storage: FrecencyStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
  return createFrecency(() => storage);
}

function render(commands: readonly Command[], opts: { sessions?: SessionInfo[]; frecency?: ReturnType<typeof memoryFrecency> } = {}) {
  act(() => root.render(
    <CommandPalette
      sessions={opts.sessions ?? []}
      initialScopeSessionId={null}
      onClose={() => {}}
      onJumpSession={() => {}}
      onOpenInExplorer={() => {}}
      onOpenInDiff={() => {}}
      commands={commands}
      frecency={opts.frecency ?? memoryFrecency()}
    />,
  ));
}

const eyebrows = () => [...container.querySelectorAll('.eyebrow')].map((e) => e.textContent);
const rows = () => [...container.querySelectorAll('.argus-cmd-row')].map((e) => e.querySelector('.argus-cmd-title')?.textContent);

function type(text: string) {
  const input = container.querySelector('input')!;
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('CommandPalette commands', () => {
  it('lists commands after sessions and runs the selected one on Enter', () => {
    const run = vi.fn();
    render([cmd('shortcut:waiting-inbox', 'Waiting inbox', { run })], { sessions: [session] });
    expect(eyebrows()).toContain('SUGGESTED');
    key('ArrowDown'); // session row → command row
    key('Enter');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('an empty query shows RECENT (by frecency) before SUGGESTED, and a run is recorded', () => {
    const f = memoryFrecency({ 'menu:zoom-in': [Date.now()] });
    render([cmd('shortcut:new-session', 'New session'), cmd('menu:zoom-in', 'Zoom In')], { frecency: f });
    expect(eyebrows().slice(0, 2)).toEqual(['RECENT', 'SUGGESTED']);
    expect(rows()).toEqual(['Zoom In', 'New session']);
    key('ArrowDown');
    key('Enter');
    expect(f.scores().get('shortcut:new-session')).toBeGreaterThan(0);
  });

  it('typed: groups matches under category eyebrows, best group first', () => {
    render([
      cmd('a', 'Theme settings…', { category: 'Settings' }),
      cmd('b', 'Theme', { category: 'View' }),
    ]);
    type('theme');
    expect(eyebrows().filter((e) => e === 'VIEW' || e === 'SETTINGS')).toEqual(['VIEW', 'SETTINGS']);
    expect(rows()).toEqual(['Theme', 'Theme settings…']);
  });

  it('> shows only commands and is stripped before matching', () => {
    render([cmd('a', 'api things')], { sessions: [session] });
    type('>api');
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toMatch(/^Commands/);
    expect(eyebrows()).not.toContain('SESSIONS');
    expect(rows()).toEqual(['api things']);
  });

  it('@ shows only sessions, # only files, and deleting the prefix restores All', () => {
    render([cmd('a', 'api things')], { sessions: [session] });
    type('@api');
    expect(eyebrows()).toContain('SESSIONS');
    expect(rows()).toEqual([]);
    type('#api');
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toMatch(/^Files/);
    expect(eyebrows()).not.toContain('SESSIONS');
    type('api');
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toMatch(/^All/);
  });

  it('renders the shortcut as a Kbd, ✓ for a checked toggle, and the danger style for a destructive row', () => {
    render([
      cmd('shortcut:new-session', 'New session', { shortcut: 'mod+n' }),
      cmd('shortcut:waiting-inbox', 'Show clock', { checked: true }),
      cmd('shortcut:session-search', 'Quit & Stop All', { destructive: true }),
    ]);
    const [a, b, c] = [...container.querySelectorAll('.argus-cmd-row')];
    expect(a.querySelector('.ds-kbd')?.textContent).toMatch(/N$/);
    expect(b.querySelector('.argus-cmd-check')?.textContent).toBe('✓');
    expect(c.hasAttribute('data-destructive')).toBe(true);
  });
});
