import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  buildRegistry,
  contributedCommands,
  registerCommands,
  resetContributionsForTests,
  useContributedCommands,
  useRegisterCommands,
} from './registry.js';
import type { Command } from './types.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const cmd = (id: string, over: Partial<Command> = {}): Command => ({
  id, title: id, category: 'View', source: 'test', run: vi.fn(), ...over,
});

afterEach(() => resetContributionsForTests());

describe('buildRegistry', () => {
  it('dedupes by id and alias, first source wins, keeping its aliases', () => {
    const a = () => [cmd('shortcut:open-diff', { aliases: ['menu:open-diff'], title: 'from menu' })];
    const b = () => [cmd('session:diff', { aliases: ['shortcut:open-diff'] }), cmd('menu:open-diff'), cmd('shortcut:open-diff')];
    const out = buildRegistry([a, b], { closePalette: () => {} });
    expect(out.map((c) => c.id)).toEqual(['shortcut:open-diff']);
    expect(out[0].title).toBe('from menu');
    expect(out[0].aliases).toEqual(['menu:open-diff']);
  });

  it('drops a command with when: false', () => {
    const out = buildRegistry([() => [cmd('a', { when: false }), cmd('b', { when: true }), cmd('c')]], { closePalette: () => {} });
    expect(out.map((c) => c.id)).toEqual(['b', 'c']);
  });

  it('closes the palette before running, unless the command keeps it open', () => {
    const order: string[] = [];
    const ctx = { closePalette: () => order.push('close') };
    const out = buildRegistry([() => [
      cmd('a', { run: () => order.push('a') }),
      cmd('b', { keepOpen: true, run: () => order.push('b') }),
    ]], ctx);
    out[0].run();
    out[1].run();
    expect(order).toEqual(['close', 'a', 'b']);
  });

  it('appends contributions after the static sources, deduped the same way', () => {
    const out = buildRegistry([() => [cmd('a')]], { closePalette: () => {} }, [cmd('a'), cmd('help:x')]);
    expect(out.map((c) => c.id)).toEqual(['a', 'help:x']);
  });
});

describe('contributions', () => {
  it('registerCommands replaces a key and its unregister only removes its own list', () => {
    const off1 = registerCommands('help', [cmd('help:a')]);
    const off2 = registerCommands('help', [cmd('help:b')]);
    off1(); // stale: must not remove the newer list
    expect(contributedCommands().map((c) => c.id)).toEqual(['help:b']);
    off2();
    expect(contributedCommands()).toEqual([]);
  });

  it('useRegisterCommands contributes while mounted and useContributedCommands re-renders', () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const list = [cmd('tips:x')];
    const seen: string[][] = [];
    function Reader() {
      seen.push(useContributedCommands().map((c) => c.id));
      return null;
    }
    function Owner() {
      useRegisterCommands('tips', list);
      return null;
    }
    const el = document.createElement('div');
    const root = createRoot(el);
    act(() => root.render(<><Reader /><Owner /></>));
    expect(seen.at(-1)).toEqual(['tips:x']);
    act(() => root.render(<Reader />));
    expect(seen.at(-1)).toEqual([]);
    act(() => root.unmount());
  });
});
