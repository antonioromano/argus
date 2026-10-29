// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Plan 008's material map, checked in the source because jsdom cannot paint:
// chrome and floating surfaces take a --material-* token, content stays opaque.

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const INDEX = read('../../index.css');

/** Body of the first rule whose selector is exactly `selector`. */
function rule(selector: string, css = INDEX): string {
  const at = css.search(new RegExp(`(^|\\n)${selector.replace(/[.[\]()*]/g, '\\$&')}\\s*\\{`));
  expect(at, selector).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('material map (plan 008)', () => {
  it('the content column is opaque and wraps the views', () => {
    expect(rule('.argus-content')).toMatch(/background:\s*var\(--bg-0\);/);
    // The opaque ancestor of every native terminal hole: a hidden overlay
    // (alpha 0) must reveal app paint, never vibrancy or the desktop.
    expect(read('../ArgusApp.tsx')).toContain('<main id="main" className="argus-content">');
  });

  it('tiles stay opaque content', () => {
    expect(rule('.argus-tile')).toMatch(/background:\s*var\(--bg-2\);/);
    expect(rule('.argus-tile-header')).toMatch(/background:\s*var\(--bg-1\);/);
  });

  it('the shell, sidebar, toolbar and chip strip paint materials', () => {
    expect(rule('.argus-shell')).toMatch(/background:\s*var\(--material-window\);/);
    expect(rule('.argus-sidebar')).toMatch(/background:\s*var\(--material-sidebar\);/);
    expect(rule('.argus-titlebar')).toMatch(/background:\s*var\(--material-toolbar\);/);
    expect(rule('.argus-chip-strip')).toMatch(/background:\s*var\(--material-toolbar\);/);
    expect(read('./WindowChrome.tsx')).toContain('className="argus-shell"');
    expect(read('./WindowChrome.tsx')).not.toContain("background: 'var(--bg-0)'");
  });

  it('chrome separators are hairlines', () => {
    expect(rule('.argus-sidebar')).toMatch(/border-right:\s*var\(--hairline\) solid/);
    expect(rule('.argus-titlebar')).toMatch(/border-bottom:\s*var\(--hairline\) solid/);
    expect(rule('.argus-chip-strip')).toMatch(/border-bottom:\s*var\(--hairline\) solid/);
  });

  it('menus, sheets and popovers are floating materials with the bounded blur', () => {
    const menu = read('../../components/primitives/ContextMenu.tsx');
    expect(menu).toContain("background: 'var(--material-menu)'");
    expect(menu).toContain('className="material-float"');
    const sheet = read('../../components/primitives/Sheet.tsx');
    expect(sheet).toContain("background: 'var(--material-sheet)'");
    expect(sheet).toContain('className="material-float"');
    const alert = read('../../components/primitives/AlertSheet.tsx');
    expect(alert).toContain("background: 'var(--material-sheet)'");
    expect(rule('.argus-ci-popover')).toMatch(/background:\s*var\(--material-popover\);/);
  });

  it('the full-window sheet scrim has no backdrop blur', () => {
    const interactions = read('../../tokens/interactions.css');
    expect(rule('.glass-overlay', interactions)).not.toMatch(/backdrop-filter/);
    expect(interactions).not.toContain('.glass-panel');
  });
});

describe('density and state rules never reflow rows (hover-no-reflow)', () => {
  const SIZE = /\b(padding|margin|height|min-height|width|border-width|font-size|line-height)\s*:/;

  it.each([
    '.argus-sidebar-row:hover',
    '.argus-sidebar-row:active',
    '.argus-sidebar-row[data-active="true"]',
    ':root[data-window-active="false"] .argus-titlebar-title',
  ])('%s changes colour only', (selector) => {
    expect(rule(selector)).not.toMatch(SIZE);
  });

  it('density moves rows through variables, so a row has one size per density', () => {
    expect(rule('.argus-sidebar-row')).toMatch(/padding:\s*var\(--row-pad-y\) var\(--s-2\);/);
    expect(rule('.argus-tile-header')).toMatch(/padding:\s*var\(--header-pad-y\) var\(--s-3\);/);
    expect(rule('.argus-sidebar')).toMatch(/width:\s*var\(--w-sidebar\);/);
    expect(rule('.argus-titlebar')).toMatch(/height:\s*var\(--h-titlebar, 44px\);/);
    const tree = read('./SessionTree.tsx');
    // Both leaf styles (hovered or not) share the one density padding.
    expect(tree.match(/padding: 'var\(--leaf-pad-y\) var\(--s-2\) var\(--leaf-pad-y\) 28px'/g)).toHaveLength(2);
  });
});
