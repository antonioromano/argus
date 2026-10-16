import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import { ShellHeaderPane } from './ShellHeaderPane.js';
import { movePart, stepThreshold } from './usageMeterSettings.js';

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
});

function mount(config: AppConfig = DEFAULT_CONFIG) {
  const onSave = vi.fn((patch: Partial<AppConfig>) => Promise.resolve({ ...config, ...patch }));
  act(() => root.render(<ShellHeaderPane config={config} onSave={onSave} />));
  return onSave;
}
const pills = () => [...container.querySelectorAll<HTMLButtonElement>('.argus-usage-pill')];

describe('ShellHeaderPane — usage meter', () => {
  it('pills show the parts in order; click toggles one', () => {
    const onSave = mount();
    expect(pills().map((p) => p.dataset.part)).toEqual(['ctx', 'plan', 'tok', 'model']);
    expect(pills().map((p) => p.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'false', 'false']);
    act(() => pills()[2]!.click());
    expect(onSave).toHaveBeenLastCalledWith({
      usageMeterParts: [{ id: 'ctx', on: true }, { id: 'plan', on: true }, { id: 'tok', on: true }, { id: 'model', on: false }],
    });
  });

  it('drag reorders and saves once on drop', () => {
    const onSave = mount();
    const [ctx, , , model] = pills();
    const fire = (el: Element, type: string) => {
      const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
      e.dataTransfer = { setData() {}, effectAllowed: '' };
      act(() => { el.dispatchEvent(e); });
    };
    fire(model!, 'dragstart');
    fire(ctx!, 'dragover');
    expect(pills().map((p) => p.dataset.part)).toEqual(['model', 'ctx', 'plan', 'tok']);
    expect(onSave).not.toHaveBeenCalled();
    fire(pills()[0]!, 'drop');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0] as unknown[])[0]).toEqual({
      usageMeterParts: [{ id: 'model', on: false }, { id: 'ctx', on: true }, { id: 'plan', on: true }, { id: 'tok', on: false }],
    });
  });

  it('Alt+arrow moves a pill for keyboard users', () => {
    const onSave = mount();
    act(() => { pills()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true })); });
    expect((onSave.mock.calls[0] as unknown[])[0]).toEqual({
      usageMeterParts: [{ id: 'plan', on: true }, { id: 'ctx', on: true }, { id: 'tok', on: false }, { id: 'model', on: false }],
    });
  });

  it('threshold steppers save amber/red', () => {
    const onSave = mount();
    const raise = container.querySelector<HTMLButtonElement>('[aria-label="Context warning"] [aria-label="Raise amber"]')!;
    act(() => raise.click());
    expect(onSave).toHaveBeenLastCalledWith({ usageWarnContext: { amber: 75, red: 90 } });
    const lowerRed = container.querySelector<HTMLButtonElement>('[aria-label="Plan usage warning"] [aria-label="Lower red"]')!;
    act(() => lowerRed.click());
    expect(onSave).toHaveBeenLastCalledWith({ usageWarnPlan: { amber: 80, red: 90 } });
  });

  it('stepThreshold keeps 5 ≤ amber < red ≤ 99', () => {
    expect(stepThreshold({ amber: 85, red: 90 }, 'amber', 5)).toEqual({ amber: 90, red: 95 });
    expect(stepThreshold({ amber: 95, red: 99 }, 'amber', 5)).toEqual({ amber: 98, red: 99 });
    expect(stepThreshold({ amber: 70, red: 75 }, 'red', -5)).toEqual({ amber: 65, red: 70 });
    expect(stepThreshold({ amber: 5, red: 10 }, 'amber', -5)).toEqual({ amber: 5, red: 10 });
    expect(movePart([{ id: 'ctx', on: true }, { id: 'plan', on: true }], 0, 5).map((p) => p.id)).toEqual(['plan', 'ctx']);
  });

  it('preview: the chip follows the settings; Gemini shows none and says why', () => {
    mount();
    const chip = () => container.querySelector('[data-testid="usage-chip"]');
    expect(chip()!.textContent).toContain('ctx');
    expect(chip()!.textContent).toContain('plan 20%');
    const gemini = [...container.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="Preview as"] button')].find((b) => b.textContent === 'Gemini')!;
    act(() => gemini.click());
    expect(chip()).toBeNull();
    expect(container.textContent).toContain('Gemini doesn’t report context or plan usage');
  });

  it('meter off: no chip in the preview, nested rows dimmed', () => {
    mount({ ...DEFAULT_CONFIG, showUsageMeter: false });
    expect(container.querySelector('[data-testid="usage-chip"]')).toBeNull();
    expect(container.querySelector('.argus-usage-nest')!.getAttribute('data-off')).toBe('true');
  });
});
