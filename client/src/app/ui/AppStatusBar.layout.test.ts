// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Layout guarantees of the app status bar (plan 009 S2) that jsdom cannot see:
// it lives outside the mosaic (so the terminals' own ResizeObservers are the
// only relayout path — see hooks/useTerminal.statusbarFit.test.tsx), its height
// is the density token, and its content can never wrap or grow the bar.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const APP = read('../ArgusApp.tsx');
const CSS = read('../../index.css');

/** Declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): Record<string, string> {
  const m = new RegExp(`(^|\\n)${selector.replace(/[.-]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(CSS);
  expect(m, selector).toBeTruthy();
  return Object.fromEntries(
    m![2].split(';').map((d) => d.split(':').map((s) => s.trim())).filter(([k, v]) => k && v).map(([k, v]) => [k, v]),
  );
}

describe('AppStatusBar layout', () => {
  it('is mounted once in ArgusApp, after the main content column — not inside Mosaic or Focus', () => {
    const mounts = APP.match(/<AppStatusBar\b/g) ?? [];
    expect(mounts).toHaveLength(1);
    expect(APP.indexOf('<AppStatusBar')).toBeGreaterThan(APP.lastIndexOf('</main>'));
    for (const view of ['../views/Mosaic.tsx', '../views/Focus.tsx']) expect(read(view), view).not.toMatch(/AppStatusBar/);
  });

  it('takes its height from the density token and never shrinks under the content row', () => {
    const bar = rule('.argus-statusbar');
    expect(bar.height).toBe('var(--h-statusbar)');
    expect(bar['flex-shrink']).toBe('0');
    expect(bar['box-sizing']).toBe('border-box');
  });

  it('keeps its content on one line at any width: no wrap, clipped rather than grown', () => {
    const bar = rule('.argus-statusbar');
    expect(bar['white-space']).toBe('nowrap');
    expect(bar.overflow).toBe('hidden');
    expect(bar['flex-wrap'] ?? 'nowrap').toBe('nowrap');
    expect(rule('.argus-statusbar-side')['min-width']).toBe('0');
  });

  it('narrows gracefully: the left side ellipsizes, the right side sheds items by priority', () => {
    expect(rule('.argus-statusbar').container).toBe('statusbar / inline-size');
    expect(rule('.argus-statusbar-side:first-child').flex).toBe('1 1 auto');
    expect(rule('.argus-statusbar-side:last-child')['flex-shrink']).toBe('0');
    expect(rule('.argus-statusbar-text')['text-overflow']).toBe('ellipsis');
    // Version goes first, then the clock, then the Remote label (its icon stays).
    const widths = ['low', 'mid'].map((p) => {
      const m = new RegExp(`@container statusbar \\(max-width: (\\d+)px\\) \\{[^}]*data-priority="${p}"`).exec(CSS);
      expect(m, p).toBeTruthy();
      return Number(m![1]);
    });
    const label = /@container statusbar \(max-width: (\d+)px\) \{[^}]*argus-statusbar-label/.exec(CSS);
    expect(label).toBeTruthy();
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(Number(label![1]));
  });
});
