// @vitest-environment node
/**
 * A jump flashes the target row, and settings hover/highlight states may only
 * change background — never size, padding or borders — so nothing reflows under
 * the pointer (feedback-hover-no-reflow). jsdom does not apply stylesheets, so
 * the rules are checked as written.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../../index.css', import.meta.url), 'utf8');

/** Declarations of every rule whose selector mentions `needle`. */
function declarationsFor(needle: string): string[] {
  const out: string[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(rule)) {
    if (!m[1].includes(needle)) continue;
    for (const d of m[2].split(';')) {
      const prop = d.split(':')[0]?.trim();
      if (prop) out.push(prop);
    }
  }
  return out;
}

const LAYOUT = /^(padding|margin|height|min-height|width|border(?!-color)|border-width|font-size|line-height|display|outline-offset)/;

describe('jump highlight styles', () => {
  it('exist for the flashed row', () => {
    expect(declarationsFor('.is-target').length).toBeGreaterThan(0);
    expect(css).toMatch(/@keyframes setting-target-flash/);
  });

  it('change no layout property', () => {
    expect(declarationsFor('.is-target').filter((p) => LAYOUT.test(p))).toEqual([]);
  });

  it('respect reduced motion with a static tint', () => {
    expect(css).toMatch(/prefers-reduced-motion[^{]*\{[^}]*\.is-target/);
  });

  it('give hit rows a hover that changes background only', () => {
    expect(declarationsFor('.settings-nav-hit:hover')).toEqual(['background']);
    expect(declarationsFor('.settings-nav-hit.is-active').filter((p) => LAYOUT.test(p))).toEqual([]);
  });
});
