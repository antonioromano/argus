import { describe, it, expect, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useOverlaySuppression } from './useOverlaySuppression.js';
import {
  registerOverlay, setSuppressionTransport, resetOverlayRegistryForTests,
} from './nativeOverlayRegistry.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined }

let hidden: string[]; let shown: string[];
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  resetOverlayRegistryForTests();
  hidden = []; shown = [];
  setSuppressionTransport({ hide: (id) => hidden.push(id), show: (id) => shown.push(id) });
});

function Surface({ target }: { target: 'all' | (() => { x: number; y: number; width: number; height: number } | null) }) {
  useOverlaySuppression(target);
  return null;
}

function mount(el: React.ReactElement) {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  act(() => root.render(el));
  return () => act(() => root.unmount());
}

describe('useOverlaySuppression', () => {
  it('hides all overlays for a full-screen surface and restores on unmount', () => {
    registerOverlay('a', { x: 0, y: 0, width: 10, height: 10 });
    const unmount = mount(<Surface target="all" />);
    expect(hidden).toEqual(['a']);
    unmount();
    expect(shown).toEqual(['a']);
  });

  it('hides only the overlapping overlay for a positioned surface', () => {
    registerOverlay('a', { x: 0, y: 0, width: 100, height: 100 });
    registerOverlay('b', { x: 500, y: 0, width: 100, height: 100 });
    const unmount = mount(<Surface target={() => ({ x: 10, y: 10, width: 5, height: 5 })} />);
    expect(hidden).toEqual(['a']);
    unmount();
  });

  it('two surfaces at once keep an overlay hidden until both close', () => {
    registerOverlay('a', { x: 0, y: 0, width: 10, height: 10 });
    const close1 = mount(<Surface target="all" />);
    const close2 = mount(<Surface target="all" />);
    close1();
    expect(shown).toEqual([]);
    close2();
    expect(shown).toEqual(['a']);
  });
});
