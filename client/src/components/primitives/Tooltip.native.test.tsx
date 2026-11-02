import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Tooltip } from './Tooltip.js';
import { registerOverlay, resetOverlayRegistryForTests, setSuppressionTransport, type Rect } from '../../hooks/nativeOverlayRegistry.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

// A tooltip must never hide a native terminal just to show a hint: it moves to
// a side that lands on none, and if every side would, a plain-text tooltip
// hands over to the OS tooltip (the trigger's title), which macOS draws above
// every window.

const VIEW = { width: 1000, height: 800 };
const TRIGGER: Rect = { x: 480, y: 380, width: 40, height: 20 };
const BUBBLE = { width: 120, height: 24 };

let container: HTMLDivElement;
let root: Root;
const hidden: string[] = [];

function rectOf(r: Rect): DOMRect {
  return { ...r, left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height, toJSON: () => r } as DOMRect;
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('innerWidth', VIEW.width);
  vi.stubGlobal('innerHeight', VIEW.height);
  resetOverlayRegistryForTests();
  hidden.length = 0;
  setSuppressionTransport({ hide: (id) => hidden.push(id), show: () => {} });
  // jsdom has no layout: the trigger and the bubble report fixed sizes, and the
  // bubble's box follows the style the tooltip gave it.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute('role') === 'tooltip') {
      const x = parseFloat(this.style.left) || 0;
      const y = parseFloat(this.style.top) || 0;
      return rectOf({ x, y, ...BUBBLE });
    }
    if (this.dataset.testid === 'trigger') return rectOf(TRIGGER);
    return rectOf({ x: 0, y: 0, width: 0, height: 0 });
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetOverlayRegistryForTests();
});

function hover(position: 'top' | 'bottom' = 'top') {
  act(() => root.render(
    <Tooltip content="Remote access settings" position={position}>
      <button data-testid="trigger" title="">Remote</button>
    </Tooltip>,
  ));
  const btn = container.querySelector('button')!;
  act(() => { btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
  act(() => { vi.advanceTimersByTime(500); });
  return btn;
}

const bubble = () => document.querySelector('[role=tooltip]') as HTMLElement;
/** Where the bubble ended up relative to the trigger. */
function side(): string {
  const top = parseFloat(bubble().style.top);
  const left = parseFloat(bubble().style.left);
  if (top < TRIGGER.y) return 'top';
  if (top >= TRIGGER.y + TRIGGER.height) return 'bottom';
  return left < TRIGGER.x ? 'left' : 'right';
}

describe('Tooltip over native terminals', () => {
  it('uses the asked-for side when it lands on no native terminal', () => {
    hover('top');
    expect(side()).toBe('top');
    expect(bubble().style.opacity).toBe('1');
    expect(hidden).toEqual([]);
  });

  it('flips to the opposite side instead of hiding the terminal above', () => {
    registerOverlay('above', { x: 0, y: 0, width: 1000, height: 375 });
    hover('top');
    expect(side()).toBe('bottom');
    expect(bubble().style.opacity).toBe('1');
    expect(hidden).toEqual([]);
  });

  it('falls back to the OS tooltip when every side would cover a terminal, and hides nothing', () => {
    registerOverlay('everywhere', { x: 0, y: 0, width: 1000, height: 800 });
    const btn = hover('top');
    expect(btn.getAttribute('title')).toBe('Remote access settings');
    expect(bubble().style.opacity).toBe('0');
    expect(hidden).toEqual([]);
  });

  it('gives the trigger its own title back when the tooltip hides', () => {
    registerOverlay('everywhere', { x: 0, y: 0, width: 1000, height: 800 });
    const btn = hover('top');
    act(() => { btn.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); });
    expect(btn.getAttribute('title')).toBe('');
  });
});
