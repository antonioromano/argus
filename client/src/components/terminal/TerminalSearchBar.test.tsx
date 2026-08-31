import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TerminalSearchBar } from './TerminalSearchBar.js';
import type { TerminalSearchEngine } from './TerminalSearchBar.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

// Setting .value directly and dispatching 'input' does not trigger React's
// onChange (React patches the native setter to detect real user input) — this
// is the standard workaround, same trick @testing-library/user-event uses
// internally.
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
function typeInto(input: HTMLInputElement, value: string) {
  nativeInputValueSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function pressKey(el: Element, key: string, opts: KeyboardEventInit = {}) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
}

function mount(el: React.ReactElement): { container: HTMLDivElement; root: Root; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(el));
  return { container, root, unmount: () => act(() => root.unmount()) };
}

/** A fake engine recording every call, with a controllable onResults fan-out. */
function fakeEngine(overrides: Partial<TerminalSearchEngine> = {}) {
  const calls: string[] = [];
  const listeners = new Set<(r: { index: number; count: number }) => void>();
  const engine: TerminalSearchEngine = {
    find: vi.fn((term: string, dir: 'next' | 'prev', opts) => {
      calls.push(`find:${term}:${dir}:${opts.caseSensitive}:${opts.regex}`);
      return overrides.find?.(term, dir, opts);
    }),
    clear: vi.fn(() => calls.push('clear')),
    onResults: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    focusTerminal: vi.fn(() => calls.push('focusTerminal')),
    ...overrides,
  };
  return { engine, calls, emitResults: (r: { index: number; count: number }) => { for (const cb of listeners) cb(r); } };
}

describe('TerminalSearchBar', () => {
  it('typing a query runs a forward find with the current toggle state', () => {
    const { engine, calls } = fakeEngine();
    const { unmount, container } = mount(<TerminalSearchBar engine={engine} onClose={() => {}} />);
    const input = container.querySelector('input')!;
    typeInto(input, 'beta');
    expect(calls).toEqual(['find:beta:next:false:false']);
    unmount();
  });

  it('Enter searches forward, Shift+Enter searches backward', () => {
    const { engine, calls } = fakeEngine();
    const { unmount, container } = mount(<TerminalSearchBar engine={engine} onClose={() => {}} />);
    const input = container.querySelector('input')!;
    typeInto(input, 'beta');
    calls.length = 0;
    pressKey(input, 'Enter');
    expect(calls).toEqual(['find:beta:next:false:false']);
    calls.length = 0;
    pressKey(input, 'Enter', { shiftKey: true });
    expect(calls).toEqual(['find:beta:prev:false:false']);
    unmount();
  });

  it('an empty query clears instead of finding', () => {
    const { engine, calls } = fakeEngine();
    const { unmount, container } = mount(<TerminalSearchBar engine={engine} onClose={() => {}} />);
    const input = container.querySelector('input')!;
    typeInto(input, 'beta');
    calls.length = 0;
    typeInto(input, '');
    expect(calls).toEqual(['clear']);
    unmount();
  });

  it('Escape clears, closes, and returns focus to the terminal', () => {
    const { engine, calls } = fakeEngine();
    const onClose = vi.fn();
    const { unmount, container } = mount(<TerminalSearchBar engine={engine} onClose={onClose} />);
    const input = container.querySelector('input')!;
    pressKey(input, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['clear', 'focusTerminal']);
    unmount();
  });

  it('a synchronous throw from the engine (bad regex) is surfaced as an error', () => {
    const { engine } = fakeEngine({
      find: () => { throw new Error('bad regex'); },
    });
    const { unmount, container } = mount(<TerminalSearchBar engine={engine} onClose={() => {}} />);
    const input = container.querySelector('input')!;
    typeInto(input, '(');
    expect(container.textContent).toContain('Bad regex');
    unmount();
  });

  it('an asynchronous rejection is also surfaced as an error', async () => {
    const { engine } = fakeEngine({ find: () => Promise.reject(new Error('native search failed')) });
    const { unmount, container } = mount(<TerminalSearchBar engine={engine} onClose={() => {}} />);
    const input = container.querySelector('input')!;
    typeInto(input, 'x');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('Bad regex');
    unmount();
  });

  it('renders the result count reported via onResults, and blank for an unknown count', () => {
    const { engine, emitResults } = fakeEngine();
    const { unmount, container } = mount(<TerminalSearchBar engine={engine} onClose={() => {}} />);
    const input = container.querySelector('input')!;
    typeInto(input, 'beta');
    act(() => emitResults({ index: 1, count: 3 }));
    expect(container.textContent).toContain('2/3');
    // count: -1 (native "found, count unknown") must not render as a number,
    // and must not be mistaken for "No results" (count === 0) either.
    act(() => emitResults({ index: 0, count: -1 }));
    expect(container.textContent).not.toContain('2/3');
    expect(container.textContent).not.toContain('No results');
    unmount();
  });

  it('renders "No results" when a query finds nothing', () => {
    const { engine, emitResults } = fakeEngine();
    const { unmount, container } = mount(<TerminalSearchBar engine={engine} onClose={() => {}} />);
    const input = container.querySelector('input')!;
    typeInto(input, 'nonexistent');
    act(() => emitResults({ index: -1, count: 0 }));
    expect(container.textContent).toContain('No results');
    unmount();
  });

  it('forwards a ref to the root element (no current caller uses it — see the component doc comment)', () => {
    const { engine } = fakeEngine();
    const ref = { current: null as HTMLDivElement | null };
    const { unmount } = mount(<TerminalSearchBar ref={ref} engine={engine} onClose={() => {}} />);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.getAttribute('role')).toBe('search');
    unmount();
  });
});
