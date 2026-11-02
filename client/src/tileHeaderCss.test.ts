// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// jsdom computes no layout, so headerShed.test.tsx can only check structure.
// The guarantee itself is CSS: the actions never shrink, and the info region
// before them takes the leftover width and clips (F12).
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
const rule = (selector: string) => {
  const m = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  expect(m, selector).not.toBeNull();
  return m![1];
};

describe('tile header CSS', () => {
  it('keeps the actions group from shrinking', () => {
    expect(rule('.argus-tile-actions')).toMatch(/flex:\s*none;/);
  });

  it('lets the info region give way and clip instead', () => {
    const info = rule('.argus-tile-info');
    expect(info).toMatch(/flex:\s*1 1 0;/);
    expect(info).toMatch(/min-width:\s*0;/);
    expect(info).toMatch(/overflow:\s*hidden;/);
  });
});
