// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DENSITY_METRICS, densityCssVars } from './density.js';

// The locked scales (plan 005, Unit 1). A grep over tokens.css, not a render:
// the renderer and the `argus/no-raw-style-scale` lint rule both assume these
// names exist, so dropping one is a regression even if nothing fails to build.

const CSS = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

/** Value of a custom property's first declaration, whitespace-collapsed. */
function decl(name: string, css = CSS): string | undefined {
  const m = css.match(new RegExp(`${name.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`));
  return m?.[1].replace(/\s+/g, ' ').trim();
}

/** Body of the first `@media (prefers-reduced-motion: reduce)` block. */
function reducedMotionBlock(): string {
  const start = CSS.indexOf('@media (prefers-reduced-motion: reduce)');
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = CSS.indexOf('{', start); i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}' && --depth === 0) return CSS.slice(start, i + 1);
  }
  throw new Error('unterminated reduced-motion block');
}

describe('type scale — six roles', () => {
  it.each([
    ['--t-eyebrow', 'var(--t-micro)'],
    ['--t-caption', 'var(--t-tiny)'],
    ['--t-small', 'var(--t-xs)'],
    ['--t-body', 'var(--t-sm)'],
    ['--t-title', 'var(--t-md)'],
    ['--t-display', 'var(--t-xl)'],
  ])('%s aliases %s', (role, value) => {
    expect(decl(role)).toBe(value);
  });

  it('body role is 13px at the default interface font', () => {
    expect(decl('--t-sm')).toBe('calc(13px * var(--ui-scale))');
  });

  it('drops the unused 4xl / 5xl steps', () => {
    expect(decl('--t-4xl')).toBeUndefined();
    expect(decl('--t-5xl')).toBeUndefined();
  });
});

describe('spacing', () => {
  it('adds the 2px half-step', () => {
    expect(decl('--s-0-5')).toBe('2px');
  });
  it('keeps the 6px half-step', () => {
    expect(decl('--s-1-5')).toBe('6px');
  });
});

describe('row heights', () => {
  it.each([
    ['--row-h-compact', 'var(--ctl-h-sm)'],
    ['--row-h', 'var(--ctl-h-md)'],
    ['--row-h-comfortable', 'var(--ctl-h-lg)'],
    ['--row-h-touch', '44px'],
  ])('%s = %s', (name, value) => {
    expect(decl(name)).toBe(value);
  });
});

describe('density re-binds row rhythm only (plan 005 row heights × plan 008 density)', () => {
  /** Everything DensityProvider may write on <html>: the row height, row/header padding, chrome geometry. */
  const REBOUND = ['--row-h', '--row-pad-y', '--leaf-pad-y', '--group-h', '--header-pad-y', '--h-titlebar', '--h-statusbar', '--w-sidebar'];

  it.each(Object.keys(DENSITY_METRICS) as (keyof typeof DENSITY_METRICS)[])('%s writes exactly the row-rhythm tokens', (d) => {
    expect(Object.keys(densityCssVars(DENSITY_METRICS[d])).sort()).toEqual([...REBOUND].sort());
  });

  it('never re-binds control heights, the row-height aliases, type, spacing or the UI scale', () => {
    const FIXED = /^--(ctl-h-|row-h-|t-|s-|lh-|font|ui-scale|code)/;
    for (const m of Object.values(DENSITY_METRICS)) {
      expect(Object.keys(densityCssVars(m)).filter((k) => FIXED.test(k))).toEqual([]);
    }
  });

  it('each density binds --row-h to a row-height alias of a control height, never a raw number', () => {
    const rowH = Object.fromEntries(Object.entries(DENSITY_METRICS).map(([d, m]) => [d, m.rowH]));
    // Default can't say var(--row-h) (it is --row-h), so it names the step --row-h aliases.
    expect(rowH).toEqual({ compact: 'var(--row-h-compact)', default: decl('--row-h'), comfortable: 'var(--row-h-comfortable)' });
    expect(decl('--row-h-compact')).toMatch(/^var\(--ctl-h-/);
    expect(decl('--row-h-comfortable')).toMatch(/^var\(--ctl-h-/);
  });

  it('no [data-density] stylesheet rule overrides tokens behind the provider\'s back', () => {
    const INDEX = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');
    expect(CSS + INDEX).not.toMatch(/\[data-density/);
  });
});

describe('radii', () => {
  it.each([
    ['--r-1', '2px'],
    ['--r-2', '4px'],
    ['--r-3', '6px'],
    ['--r-4', '10px'],
    ['--r-pill', '999px'],
  ])('%s = %s', (name, value) => {
    expect(decl(name)).toBe(value);
  });
});

describe('motion', () => {
  it('has one easing, and the old std/out/in aliases are gone', () => {
    expect(decl('--ease')).toBe('cubic-bezier(.22, .61, .36, 1)');
    for (const alias of ['--ease-std', '--ease-out', '--ease-in']) expect(decl(alias)).toBeUndefined();
  });

  it.each(['--dur-fast', '--dur-base', '--dur-slow', '--dur-ambient'])('keeps %s', (name) => {
    expect(decl(name)).toMatch(/^\d+ms$/);
  });

  it.each([
    ['--motion-sidebar-collapse', '520ms'],
    ['--motion-sidebar-expand', '450ms'],
    ['--ease-sidebar-collapse', 'cubic-bezier(.4, 0, .6, 1)'],
    ['--ease-sidebar-expand', 'cubic-bezier(.4, 0, 1, 1)'],
    ['--motion-tile-genie-out', '340ms'],
    ['--motion-tile-genie-in', '380ms'],
  ])('signature motion %s = %s', (name, value) => {
    expect(decl(name)).toBe(value);
  });

  it('reduced motion zeroes the three durations', () => {
    const block = reducedMotionBlock();
    for (const d of ['--dur-fast', '--dur-base', '--dur-slow']) {
      expect(decl(d, block)).toBe('0ms');
    }
  });
});

describe('plan 008 tokens', () => {
  it('hairline is 1px, 0.5px on Retina', () => {
    expect(decl('--hairline')).toBe('1px');
    expect(CSS).toMatch(/@media \(min-resolution: 2dppx\)\s*\{\s*:root\s*\{\s*--hairline:\s*0\.5px;/);
  });

  it('system accent falls back to the brand accent', () => {
    expect(CSS).toContain('--sys-accent: var(--sys-accent-color, var(--accent));');
  });

  it('focus ring, selection and native controls use the system accent', () => {
    expect(CSS).toMatch(/\*:focus-visible\s*\{\s*outline:\s*2px solid var\(--sys-accent\);/);
    expect(CSS).toMatch(/::selection\s*\{[^}]*var\(--sys-accent\)/);
    expect(CSS).toMatch(/accent-color:\s*var\(--sys-accent\)/);
  });

  it('the inactive window greys the system accent, not the brand accent', () => {
    const m = /:root\[data-window-active="false"\]\s*\{([^}]*)\}/.exec(CSS);
    expect(m?.[1]).toContain('--sys-accent: var(--fg-4)');
    expect(m?.[1]).not.toContain('--accent:');
  });

  it('body paints the window material, which is opaque unless translucent', () => {
    expect(CSS).toMatch(/body\s*\{[^}]*background:\s*var\(--material-window\);/);
    const solid = /:root:not\(\[data-material="translucent"\]\)\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(decl('--material-window', solid)).toBe('var(--bg-0)');
    const translucent = /:root\[data-material="translucent"\]\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(decl('--material-window', translucent)).toBe('transparent');
  });
});
