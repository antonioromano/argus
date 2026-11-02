import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Density } from '@argus/shared';
import { FileTreeView } from './FileTreeView.js';
import { DensityProvider } from '../../context/DensityContext.js';
import { FontSettingsProvider } from '../../context/FontSettingsContext.js';
import { DENSITY_METRICS } from '../../tokens/density.js';
import type { VisibleNode } from '../../hooks/useFileTree.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

const nodes: VisibleNode[] = ['a.ts', 'b.ts', 'c.ts'].map((name) => ({
  path: `/r/${name}`, depth: 0, expanded: false, loading: false,
  entry: { name, path: `/r/${name}`, hasChildren: false, isFile: true, ext: 'ts' },
}));

/** The virtualizer's sizer: its height is rows × row height, whatever the viewport. */
function totalHeight(density: Density, uiFontSize = 14): number {
  act(() => root.render(
    <FontSettingsProvider uiFontSize={uiFontSize} codeFontSize={13}>
      <DensityProvider density={density}>
        <FileTreeView nodes={nodes} selectedPath={null} gitStatuses={new Map()} onSelect={() => {}} />
      </DensityProvider>
    </FontSettingsProvider>,
  ));
  const sizer = container.querySelector<HTMLElement>('div[style*="position: relative"]');
  return parseFloat(sizer!.style.height);
}

describe('FileTreeView rows follow the density', () => {
  it.each<Density>(['compact', 'default', 'comfortable'])('%s at the default interface font', (d) => {
    expect(totalHeight(d)).toBe(nodes.length * DENSITY_METRICS[d].treeRowH);
  });

  it('still scales with the interface font', () => {
    expect(totalHeight('compact', 21)).toBe(nodes.length * Math.round(DENSITY_METRICS.compact.treeRowH * 21 / 14));
  });
});
