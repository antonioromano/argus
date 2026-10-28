// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// jsdom does no layout, so the composer's auto-grow lives only in CSS: guard it.
describe('index.css — Chat composer height (F4)', () => {
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
  const rule = (selector: string) => new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[2] ?? '';

  it('the Chat view is a size container, so cqh is a share of its height', () => {
    expect(rule('.argus-chat')).toMatch(/container-type:\s*size;/);
  });

  it('the textarea grows with its text up to 45% of the view', () => {
    const textarea = rule('.argus-chat-composer textarea');
    expect(textarea).toMatch(/field-sizing:\s*content;/);
    expect(textarea).toMatch(/max-height:\s*45cqh;/);
    expect(textarea).not.toMatch(/240px/);
  });
});
