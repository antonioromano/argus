import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Sidebar } from './Sidebar.js';
import { DensityProvider } from '../../context/DensityContext.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  localStorage.clear();
});

const inspector = <div data-testid="inspector-stub">inspector</div>;

function render(collapsedChanges: boolean[] = [], expandRequest = 0) {
  act(() => root.render(
    <Sidebar
      onSelect={() => {}}
      expandRequest={expandRequest}
      sessionTree={<div data-testid="tree" />}
      inspector={inspector}
      onCollapsedChange={(c) => collapsedChanges.push(c)}
    />,
  ));
}

describe('Sidebar — Session Inspector (stacked layout)', () => {
  it('sits between the Pilot rows (shells + Find & Jump) and System', () => {
    render();
    const aside = container.querySelector('aside')!;
    const order = Array.from(aside.querySelectorAll('[data-testid="tree"], .argus-sidebar-row, .argus-sidebar-inspector, .eyebrow'))
      .filter((el) => !el.closest('.argus-sidebar-inspector') || el.classList.contains('argus-sidebar-inspector'))
      .map((el) => el.classList.contains('argus-sidebar-inspector') ? 'inspector'
        : el.getAttribute('data-testid') ?? el.textContent);
    expect(order).toEqual(['Pilot', 'Shells', 'tree', 'Find & Jump⌘K', 'inspector', 'System', 'Settings']);
  });

  it('is not rendered while the sidebar is collapsed, and reports the state', () => {
    localStorage.setItem('argus-sidebar-collapsed', '1');
    const changes: boolean[] = [];
    render(changes);
    expect(container.querySelector('[data-testid="inspector-stub"]')).toBeNull();
    expect(changes).toEqual([true]);
  });

  it('expands on request so the inspector it holds becomes visible', () => {
    localStorage.setItem('argus-sidebar-collapsed', '1');
    const changes: boolean[] = [];
    render(changes);
    render(changes, 1);
    expect(container.querySelector('[data-testid="inspector-stub"]')).not.toBeNull();
    expect(changes.at(-1)).toBe(false);
  });
});

describe('Sidebar — width and density', () => {
  const renderAt = (density: string) => act(() => root.render(
    <DensityProvider density={density}>
      <Sidebar onSelect={() => {}} sessionTree={<div />} />
    </DensityProvider>,
  ));
  const width = () => container.querySelector<HTMLElement>('aside')!.style.width;

  it('follows the density until dragged: Compact narrows it to 200px', () => {
    renderAt('default');
    expect(width()).toBe('220px');
    renderAt('compact');
    expect(width()).toBe('200px');
    expect(localStorage.getItem('argus-sidebar-width')).toBeNull();
  });

  it('a stored 220 (the old auto-saved default) still follows the density', () => {
    localStorage.setItem('argus-sidebar-width', '220');
    renderAt('compact');
    expect(width()).toBe('200px');
  });

  it('a dragged width wins over the density', () => {
    localStorage.setItem('argus-sidebar-width', '300');
    renderAt('compact');
    expect(width()).toBe('300px');
  });
});
