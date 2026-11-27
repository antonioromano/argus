import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  it('sits between the Pilot rows (shells) and System', () => {
    render();
    const aside = container.querySelector('aside')!;
    const order = Array.from(aside.querySelectorAll('[data-testid="tree"], .argus-sidebar-row, .argus-sidebar-inspector, .eyebrow'))
      .filter((el) => !el.closest('.argus-sidebar-inspector') || el.classList.contains('argus-sidebar-inspector'))
      .map((el) => el.classList.contains('argus-sidebar-inspector') ? 'inspector'
        : el.getAttribute('data-testid') ?? el.textContent);
    expect(order).toEqual(['Pilot', 'Sessions', 'tree', 'inspector', 'System', 'Settings']);
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

describe('Sidebar — click on the background toggles it', () => {
  function renderWith(sessionTree = <div data-testid="tree" />) {
    const selected: string[] = [];
    act(() => root.render(
      <Sidebar
        onSelect={(k) => selected.push(k)}
        sessionTree={sessionTree}
        inspector={inspector}
        checklist={<div data-testid="checklist">checklist</div>}
      />,
    ));
    return selected;
  }
  const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  const isCollapsed = () => container.querySelector('aside')!.hasAttribute('data-collapsed');

  it('expands a collapsed sidebar when its blank area is clicked', () => {
    localStorage.setItem('argus-sidebar-collapsed', '1');
    renderWith();
    click(container.querySelector('aside')!);
    expect(isCollapsed()).toBe(false);
  });

  it('collapses an expanded sidebar when an eyebrow label is clicked', () => {
    vi.useFakeTimers();
    try {
      renderWith();
      click([...container.querySelectorAll('.eyebrow')].find((e) => e.textContent === 'System')!);
      act(() => { vi.runAllTimers(); });
      expect(isCollapsed()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a nav row selects without toggling', () => {
    const selected = renderWith();
    click([...container.querySelectorAll('.argus-sidebar-row')].find((b) => b.textContent?.includes('Settings'))!);
    expect(selected).toEqual(['settings']);
    expect(isCollapsed()).toBe(false);
    expect(container.querySelector('aside')!.getAttribute('data-animating')).toBeNull();
  });

  it('a session row opens without toggling', () => {
    const onOpen = vi.fn();
    renderWith(<div role="button" data-testid="shell" onClick={onOpen}><span data-testid="shell-label">alpha</span></div>);
    click(container.querySelector('[data-testid="shell-label"]')!);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(container.querySelector('aside')!.getAttribute('data-animating')).toBeNull();
  });

  it('a press that starts on the resize handle and ends on blank space does not toggle', () => {
    renderWith();
    const aside = container.querySelector('aside')!;
    const handle = aside.querySelector('[data-sidebar-no-toggle][title^="Drag to resize"]')!;
    act(() => { handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    click(aside);
    expect(aside.getAttribute('data-animating')).toBeNull();
    expect(isCollapsed()).toBe(false);
    // The next genuine background click still toggles.
    act(() => { aside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    click(aside);
    expect(aside.getAttribute('data-animating')).not.toBeNull();
  });

  it('clicks inside the inspector or the checklist do not toggle', () => {
    renderWith();
    click(container.querySelector('[data-testid="inspector-stub"]')!);
    click(container.querySelector('[data-testid="checklist"]')!);
    expect(container.querySelector('aside')!.getAttribute('data-animating')).toBeNull();
    expect(isCollapsed()).toBe(false);
  });
});
