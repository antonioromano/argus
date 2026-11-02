import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AppInfo } from '@argus/shared';
import type { ElectronHelpBridge } from '../../utils/platform.js';
import { AboutSheet } from './AboutSheet.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as Window & { electronShell?: unknown }).electronShell;
});

const INFO: AppInfo = {
  appVersion: '0.31.0',
  build: { sha: 'abc1234', builtAt: '2026-10-29T10:00:00Z', dirty: false },
  packaged: true, macos: '26.1', arch: 'arm64', electron: '39.0.0', chrome: '142.0', node: '22.20.0',
  links: { repo: 'https://github.com/antonioromano/argus', license: 'https://github.com/antonioromano/argus/blob/main/LICENSE', releases: 'https://github.com/antonioromano/argus/releases', docs: 'https://github.com/antonioromano/argus#readme' },
};

function render(bridge?: ElectronHelpBridge) {
  const props = { onClose: vi.fn(), onWhatsNew: vi.fn(), onCopyDiagnostics: vi.fn(), onCheckForUpdates: vi.fn() };
  act(() => { root.render(<AboutSheet version="0.30.9" bridge={bridge} {...props} />); });
  return props;
}
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === label)!;

describe('AboutSheet', () => {
  it('shows the update-service version and "dev build" without the bridge', () => {
    render(undefined);
    expect(document.body.textContent).toContain('Version 0.30.9');
    expect(document.body.textContent).toContain('dev build');
    expect(button('License')).toBeUndefined();
  });

  it('shows the build and runtimes from main, and opens links through the allowlisted bridge', async () => {
    const openExternal = vi.fn();
    (window as Window & { electronShell?: unknown }).electronShell = { openExternal };
    render({ appInfo: async () => INFO, copyDiagnostics: vi.fn(), reportIssue: vi.fn() });
    await act(async () => { await Promise.resolve(); });
    expect(document.body.textContent).toContain('Version 0.31.0');
    expect(document.body.textContent).toContain('build abc1234 · 2026-10-29');
    expect(document.body.textContent).toContain('Electron 39.0.0');
    act(() => button('License').click());
    expect(openExternal).toHaveBeenCalledWith(INFO.links.license);
  });

  it('wires its buttons', () => {
    const p = render(undefined);
    act(() => button('Copy Diagnostics').click());
    act(() => button('What’s New').click());
    act(() => button('Check for Updates…').click());
    expect(p.onCopyDiagnostics).toHaveBeenCalledOnce();
    expect(p.onWhatsNew).toHaveBeenCalledOnce();
    expect(p.onCheckForUpdates).toHaveBeenCalledOnce();
  });
});
