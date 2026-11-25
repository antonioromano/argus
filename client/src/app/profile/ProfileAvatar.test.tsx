import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ProfilesState } from '@argus/shared';
import { ProfileAvatar } from './ProfileAvatar.js';

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

const p = (id: string, name: string, avatar = '') => ({ id, name, avatar, createdAt: 1, settings: {} });
function render(state: ProfilesState | null) {
  const h = { onSetup: vi.fn(), onSwitch: vi.fn(), onEdit: vi.fn(), onNew: vi.fn() };
  act(() => root.render(<ProfileAvatar state={state} {...h} />));
  return h;
}
const item = (label: string) => Array.from(document.querySelectorAll('[role=menuitem]')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

describe('ProfileAvatar', () => {
  it('renders nothing before profiles load', () => {
    render(null);
    expect(container.querySelector('.argus-avatar')).toBeNull();
  });

  it('is a placeholder that starts setup when there is no profile, with a dot after "Later"', () => {
    const h = render({ activeId: null, profiles: [], prompt: 'pending' });
    const btn = container.querySelector<HTMLButtonElement>('.argus-avatar')!;
    expect(btn.hasAttribute('data-empty')).toBe(true);
    expect(container.querySelector('.argus-avatar-pip')).toBeNull();
    act(() => btn.click());
    expect(h.onSetup).toHaveBeenCalled();
    render({ activeId: null, profiles: [], prompt: 'later' });
    expect(container.querySelector('.argus-avatar-pip')).not.toBeNull();
  });

  it('shows the active profile and switches, edits or adds from its menu', () => {
    const h = render({ activeId: 'a', profiles: [p('a', 'Ada Lovelace'), p('b', 'Work', '🚀')], prompt: 'done' });
    const btn = container.querySelector<HTMLButtonElement>('.argus-avatar')!;
    expect(btn.textContent).toBe('AL');
    act(() => btn.click());
    act(() => item('Work').click());
    expect(h.onSwitch).toHaveBeenCalledWith('b');
    act(() => btn.click());
    act(() => item('Ada Lovelace').click());
    expect(h.onSwitch).toHaveBeenCalledTimes(1); // already active: no switch
    act(() => btn.click());
    act(() => item('Edit profile').click());
    expect(h.onEdit).toHaveBeenCalled();
    act(() => btn.click());
    act(() => item('New profile').click());
    expect(h.onNew).toHaveBeenCalled();
  });
});
