import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ThemeProvider } from './ThemeContext.js';
import { useTheme, type ThemeContextValue } from './theme-context.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type W = Window & { electronAppearance?: unknown };

let container: HTMLDivElement;
let root: Root;
const seen: ThemeContextValue[] = [];
const ctx = () => seen[seen.length - 1];
const setTheme = vi.fn();

function Probe() {
  seen.push(useTheme());
  return null;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  setTheme.mockClear();
  seen.length = 0;
  (window as W).electronAppearance = { snapshot: () => undefined, onChange: () => () => {}, setTheme };
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as W).electronAppearance;
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

describe('ThemeProvider → nativeTheme sync', () => {
  it('hands the choice back to macOS in system mode', () => {
    act(() => root.render(<ThemeProvider><Probe /></ThemeProvider>));
    expect(ctx().mode).toBe('system');
    expect(setTheme).toHaveBeenLastCalledWith('system');
  });

  it('sends the explicit theme after a toggle', () => {
    localStorage.setItem('theme-mode', 'light');
    act(() => root.render(<ThemeProvider><Probe /></ThemeProvider>));
    expect(setTheme).toHaveBeenLastCalledWith('light');
    act(() => ctx().toggle());
    expect(setTheme).toHaveBeenLastCalledWith('dark');
  });

  it('works without the Electron bridge', () => {
    delete (window as W).electronAppearance;
    act(() => root.render(<ThemeProvider><Probe /></ThemeProvider>));
    expect(ctx().theme).toBe('light');
  });
});
