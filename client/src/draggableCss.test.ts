// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// jsdom has no UA stylesheet, so a drag test there passes even when the real
// renderer refuses to start the drag. Guard the CSS rule itself: without it,
// `all: unset` on a draggable element (usage pills, minimized chips) resets
// -webkit-user-drag to `auto` and Chromium never fires dragstart.
describe('index.css', () => {
  it('keeps [draggable=true] elements draggable despite all: unset', () => {
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\[draggable='true'\]\s*\{\s*-webkit-user-drag:\s*element\s*!important;/);
  });
});
