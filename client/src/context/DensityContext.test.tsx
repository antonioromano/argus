import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Density } from '@argus/shared';
import { DensityProvider } from './DensityContext.js';
import { useDensity, type DensityContextValue } from './density-context.js';
import { DENSITY_METRICS } from '../tokens/density.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;
const seen: DensityContextValue[] = [];

function Probe() {
  seen.push(useDensity());
  return null;
}

const html = () => document.documentElement;
const render = (density?: unknown) =>
  act(() => root.render(<DensityProvider density={density}><Probe /></DensityProvider>));

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  seen.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

describe('DensityProvider', () => {
  it.each<Density>(['compact', 'default', 'comfortable'])('%s: writes data-density and the table to <html>', (d) => {
    render(d);
    const m = DENSITY_METRICS[d];
    expect(html().dataset.density).toBe(d);
    expect(html().style.getPropertyValue('--row-pad-y')).toBe(`${m.rowPadY}px`);
    expect(html().style.getPropertyValue('--header-pad-y')).toBe(`${m.headerPadY}px`);
    expect(html().style.getPropertyValue('--h-titlebar')).toBe(`${m.titlebarH}px`);
    expect(html().style.getPropertyValue('--w-sidebar')).toBe(`${m.sidebarW}px`);
    expect(seen[seen.length - 1]).toEqual({ density: d, ...m });
  });

  it('Compact narrows the sidebar and lowers the toolbar', () => {
    render('compact');
    expect(seen[seen.length - 1].sidebarW).toBe(200);
    expect(seen[seen.length - 1].titlebarH).toBe(38);
  });

  it('treats an unknown value as Default', () => {
    render('huge');
    expect(html().dataset.density).toBe('default');
    expect(seen[seen.length - 1].density).toBe('default');
  });

  it('clears <html> on unmount', () => {
    render('compact');
    act(() => root.unmount());
    expect(html().dataset.density).toBeUndefined();
    expect(html().style.getPropertyValue('--row-pad-y')).toBe('');
    act(() => { root = createRoot(container); });
  });
});
