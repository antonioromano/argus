import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Sidebar } from './Sidebar.js';

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
