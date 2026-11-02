import { describe, it, expect, vi } from 'vitest';
import { shortcutsSource } from './shortcuts.js';
import { stubContext } from './testContext.js';

describe('shortcutsSource', () => {
  it('lists the inspector toggle with its live state and binding', () => {
    const toggleInspector = vi.fn();
    const [c] = shortcutsSource(stubContext({ inspectorShown: false, toggleInspector }));
    expect(c.id).toBe('shortcut:toggle-inspector');
    expect(c.title).toBe('Show Session Inspector');
    expect(c.shortcut).toBe('mod+i');
    expect(c.aliases).toContain('settings.toggle:inspectorVisible');
    c.run();
    expect(toggleInspector).toHaveBeenCalled();
  });

  it('offers Find in files only while the explorer scope is active', () => {
    const off = shortcutsSource(stubContext()).find((c) => c.id === 'shortcut:find-in-files')!;
    expect(off.when).toBe(false);
    const handler = vi.fn();
    const on = shortcutsSource(stubContext({ scopedHandler: (id) => (id === 'find-in-files' ? handler : null) }))
      .find((c) => c.id === 'shortcut:find-in-files')!;
    expect(on.when).toBe(true);
    on.run();
    expect(handler).toHaveBeenCalled();
  });
});
