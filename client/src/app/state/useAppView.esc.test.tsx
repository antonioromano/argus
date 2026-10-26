import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useAppView, type AppViewApi } from './useAppView.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Esc through the real hook: a maximized PR diff closes back to where it was opened.
let container: HTMLDivElement;
let root: Root;
let app: AppViewApi;

function Harness({ onApp }: { onApp: (a: AppViewApi) => void }) {
  const a = useAppView();
  useEffect(() => { onApp(a); });
  return null;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); root.render(<Harness onApp={(a) => { app = a; }} />); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

const esc = () => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
const pr = { url: 'https://github.com/o/r/pull/7', pr: null, folderBranch: false, linked: true };

describe('useAppView — Esc on the PR diff', () => {
  it('closes a PR diff opened from the mosaic back to the mosaic', () => {
    expect(app.view).toBe('dashboard');
    act(() => app.openMaximized({ kind: 'prdiff', sessionId: 's1', pr }));
    expect(app.view).toBe('focus');
    expect(app.sidePanel).toMatchObject({ kind: 'prdiff', maximized: true });
    esc();
    expect(app.sidePanel).toBeNull();
    expect(app.view).toBe('dashboard');
  });
});
