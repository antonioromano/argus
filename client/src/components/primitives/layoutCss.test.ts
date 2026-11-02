// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { space, spaceSuffix, SPACE_TOKENS, TEXT_SIZES, TEXT_TONES } from './scale.js';

// Layout.tsx emits `.ds-*` class names built from the scale.ts types; the rules
// live in index.css. Keep the two in step: a type that compiles but has no CSS
// rule would render unstyled with no error anywhere.

const css = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf8');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('index.css DS LAYOUT block', () => {
  it.each(SPACE_TOKENS.filter((t) => t !== 0))('defines .ds-gap for %s', (t) => {
    expect(css).toContain(`.ds-gap-${spaceSuffix(t)} { gap: ${space(t)}; }`);
  });

  it.each(TEXT_SIZES)('defines .ds-t-%s on its role token', (size) => {
    expect(css).toMatch(new RegExp(`\\.ds-t-${size}\\s*\\{ font-size: var\\(--t-${size}\\); \\}`));
  });

  it.each(Object.entries(TEXT_TONES))('defines .ds-tone-%s as %s', (tone, value) => {
    expect(css).toMatch(new RegExp(`\\.ds-tone-${tone}\\s*\\{ color: ${esc(value)}; \\}`));
  });

  it('sets no :hover rule on a ds class (hover must not reflow rows)', () => {
    expect(css).not.toMatch(/\.ds-[\w-]+[^{}]*:hover/);
  });
});
