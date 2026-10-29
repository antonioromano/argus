// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  it('has one easing; std/out/in alias it', () => {
    expect(decl('--ease')).toBe('cubic-bezier(.22, .61, .36, 1)');
    expect(decl('--ease-std')).toBe('var(--ease)');
    expect(decl('--ease-out')).toBe('var(--ease)');
    expect(decl('--ease-in')).toBe('var(--ease)');
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

describe('room left for plan 008', () => {
  // 008 (macOS polish) owns these; defining them here would pre-empt its choices.
  it.each(['--hairline', '--sys-accent'])('does not define %s', (name) => {
    expect(decl(name)).toBeUndefined();
  });
  it('does not define --material-* tokens', () => {
    expect(CSS).not.toMatch(/--material-[\w-]+\s*:/);
  });
});
