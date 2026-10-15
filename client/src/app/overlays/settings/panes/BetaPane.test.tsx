import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import { BetaPane } from './BetaPane.js';
import { BETA_FEATURES } from '../../../../utils/betaFlags.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

let container: HTMLDivElement; let root: Root;
let onSave: ReturnType<typeof vi.fn>;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  onSave = vi.fn().mockResolvedValue(DEFAULT_CONFIG);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

function render(config: Partial<AppConfig> = {}) {
  act(() => { root.render(<BetaPane config={{ ...DEFAULT_CONFIG, ...config }} onSave={onSave as never} />); });
}
const row = (flag: string) => container.querySelector(`[data-testid="beta-${flag}"]`) as HTMLElement;
/** The Toggle's clickable track (the label's first span). */
const track = (flag: string) => row(flag).querySelector('label > span') as HTMLElement;

describe('BetaPane', () => {
  it('lists every beta feature with a Beta tag and a description', () => {
    render();
    for (const f of BETA_FEATURES) {
      const r = row(f.flag);
      expect(r).toBeTruthy();
      expect(r.textContent).toContain(f.label);
      expect(r.textContent).toContain('Beta');
      expect(r.textContent).toContain(f.description);
    }
  });

  it('toggles worktree lifecycle on and off as a strict boolean', () => {
    render();
    act(() => { track('betaWorktreeLifecycle').click(); });
    expect(onSave).toHaveBeenLastCalledWith({ betaWorktreeLifecycle: true });

    render({ betaWorktreeLifecycle: true });
    act(() => { track('betaWorktreeLifecycle').click(); });
    expect(onSave).toHaveBeenLastCalledWith({ betaWorktreeLifecycle: false });
  });

  it('toggles agent handoff (F12), which is no longer coming soon', () => {
    render();
    expect(row('betaHandoff').textContent).not.toMatch(/coming soon/i);
    act(() => { track('betaHandoff').click(); });
    expect(onSave).toHaveBeenLastCalledWith({ betaHandoff: true });
  });

  it('toggles session templates (F10), which is no longer coming soon', () => {
    render();
    expect(row('betaSessionTemplates').textContent).not.toMatch(/coming soon/i);
    act(() => { track('betaSessionTemplates').click(); });
    expect(onSave).toHaveBeenLastCalledWith({ betaSessionTemplates: true });
  });

  it('toggles the activity timeline (F6), which is no longer coming soon', () => {
    render();
    expect(row('betaActivityTimeline').textContent).not.toMatch(/coming soon/i);
    act(() => { track('betaActivityTimeline').click(); });
    expect(onSave).toHaveBeenLastCalledWith({ betaActivityTimeline: true });
  });

  it('keeps coming-soon features disabled and off, even if the config says on', () => {
    const soon = BETA_FEATURES.filter((f) => !f.available);
    expect(soon.map((f) => f.flag).sort()).toEqual(
      ['betaSessionChains'],
    );
    render(Object.fromEntries(soon.map((f) => [f.flag, true])));
    for (const f of soon) {
      expect(row(f.flag).textContent).toMatch(/coming soon/i);
      act(() => { track(f.flag).click(); });
      // Rendered off: the knob sits at the start of the track.
      expect((track(f.flag).firstElementChild as HTMLElement).style.transform).toBe('translateX(0)');
    }
    expect(onSave).not.toHaveBeenCalled();
  });
});
