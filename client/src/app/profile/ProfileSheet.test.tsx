import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG } from '@argus/shared';
import { ProfileSheet } from './ProfileSheet.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined }

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

const profile = { id: 'p', name: 'Ada Lovelace', avatar: '', createdAt: 1, settings: {} };
function render(mode: 'setup' | 'edit', extra: Partial<Parameters<typeof ProfileSheet>[0]> = {}) {
  const props = {
    mode, profile, config: structuredClone(DEFAULT_CONFIG),
    onConfig: vi.fn(), onIdentity: vi.fn(), onCancel: vi.fn(), onDone: vi.fn(), ...extra,
  };
  act(() => root.render(<ProfileSheet {...props} />));
  return props;
}
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)!;
const navItems = () => Array.from(document.querySelectorAll('.argus-profile-nav .settings-nav-item')).map((b) => b.textContent?.trim());

describe('ProfileSheet', () => {
  it('guides through every step with Continue, then finishes', () => {
    const p = render('setup');
    expect(navItems()).toEqual(['You', 'Theme', 'Look', 'Session header', 'Usage meter', 'Sessions', 'Notifications', 'Done']);
    expect(document.body.textContent).toContain('Step 1 of 8');
    for (let i = 0; i < 6; i++) act(() => button('Continue').click());
    act(() => button('Finish').click());
    expect(document.body.textContent).toContain('All set, Ada');
    act(() => button('Start using Argus').click());
    expect(p.onDone).toHaveBeenCalledTimes(1);
  });

  it('cancels a setup', () => {
    const p = render('setup');
    act(() => button('Cancel').click());
    expect(p.onCancel).toHaveBeenCalledTimes(1);
  });

  it('applies a choice live', () => {
    const p = render('setup');
    act(() => button('Continue').click()); // Theme
    act(() => button('Continue').click()); // Look
    act(() => button('Compact').click());
    expect(p.onConfig).toHaveBeenCalledWith({ density: 'compact' });
  });

  it('opens on Theme as free tabs when editing, with Delete only when allowed', () => {
    render('edit');
    expect(navItems()).not.toContain('Done');
    expect(document.body.textContent).toContain('Changes save as you go');
    expect(button('Delete profile')).toBeUndefined();
    const onDelete = vi.fn();
    render('edit', { onDelete });
    act(() => button('Delete profile').click());
    expect(onDelete).toHaveBeenCalled();
  });

  it('builds the usage meter: switch and thresholds apply live', () => {
    const p = render('edit');
    act(() => (Array.from(document.querySelectorAll('.argus-profile-nav .settings-nav-item')).find((b) => b.textContent?.trim() === 'Usage meter') as HTMLButtonElement).click());
    expect(document.body.textContent).toContain('Click to hide · drag to reorder');
    const row = Array.from(document.querySelectorAll('.setting-row')).find((r) => r.querySelector('.setting-row-label')?.textContent === 'Show usage meter')!;
    act(() => (row.querySelector('label > span') as HTMLElement).click());
    expect(p.onConfig).toHaveBeenCalledWith({ showUsageMeter: false });
  });

  it('sets the avatar', () => {
    const p = render('setup');
    const owl = Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Avatar 🦉')!;
    act(() => owl.click());
    expect(p.onIdentity).toHaveBeenCalledWith({ avatar: '🦉' });
  });
});
