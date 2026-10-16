import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type PlanUsage, type SessionUsage } from '@argus/shared';
import { UsageChip } from './UsageChip.js';
import { usageMeterView, type UsageMeterView } from '../../utils/usageFormat.js';

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

const NOW = 1_800_000_000_000;
const base: SessionUsage = {
  inputTokens: 10, outputTokens: 10, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 19_900_000, updatedAt: 0,
  contextPct: 47, contextTokens: 94_000, contextWindow: 200_000, model: 'claude-opus-5-5',
};
const plan = (usedPct: number): PlanUsage => ({ observedAt: NOW, primary: { usedPct, resetsAt: NOW + (2 * 60 + 19) * 60_000, windowMinutes: 300 } });
const defaults = usageMeterView(DEFAULT_CONFIG)!;

function render(props: { agentType?: string; usage?: SessionUsage; plan?: PlanUsage; view?: UsageMeterView }) {
  act(() => root.render(
    <UsageChip agentType={props.agentType ?? 'claude'} usage={props.usage} plan={props.plan} view={props.view ?? defaults} now={NOW} />,
  ));
  return container.querySelector('[data-testid="usage-chip"]');
}

describe('UsageChip', () => {
  it('default parts: context bar + % and plan usage with its reset', () => {
    const chip = render({ usage: base, plan: plan(20) })!;
    expect(chip.textContent).toBe('ctx 47%·plan 20%·↻ 2h19m');
    expect(chip.querySelector('.argus-usage-bar > i')!.getAttribute('style')).toContain('width: 47%');
    expect(chip.getAttribute('data-level')).toBe('ok');
    expect(chip.textContent).not.toContain('$');
  });

  it('follows the part order and visibility', () => {
    const view = { ...defaults, parts: [{ id: 'model', on: true }, { id: 'tok', on: true }, { id: 'ctx', on: false }, { id: 'plan', on: true }] } as UsageMeterView;
    const chip = render({ usage: base, plan: plan(20), view })!;
    expect([...chip.querySelectorAll('.argus-usage-part')].map((e) => e.getAttribute('data-part'))).toEqual(['model', 'tok', 'plan']);
    expect(chip.textContent).toContain('opus-5-5');
    expect(chip.textContent).toContain('20M tok');
  });

  it('thresholds turn parts amber / red and the chip takes the worst', () => {
    let chip = render({ usage: { ...base, contextPct: 72 }, plan: plan(20) })!;
    expect(chip.querySelector('[data-part="ctx"]')!.getAttribute('data-level')).toBe('warn');
    expect(chip.getAttribute('data-level')).toBe('warn');
    chip = render({ usage: { ...base, contextPct: 72 }, plan: plan(96) })!;
    expect(chip.querySelector('[data-part="plan"]')!.getAttribute('data-level')).toBe('high');
    expect(chip.getAttribute('data-level')).toBe('high');
    const strict = { ...defaults, warnContext: { amber: 40, red: 45 } };
    chip = render({ usage: base, plan: plan(20), view: strict })!;
    expect(chip.getAttribute('data-level')).toBe('high');
  });

  it('a stale plan window shows as reset (0%) with no countdown', () => {
    const stale: PlanUsage = { observedAt: NOW - 1, primary: { usedPct: 97, resetsAt: NOW - 1, windowMinutes: 300 } };
    const chip = render({ usage: base, plan: stale })!;
    expect(chip.textContent).toBe('ctx 47%·plan 0%');
    expect(chip.getAttribute('data-level')).toBe('ok');
  });

  it('Codex shows context and plan usage too', () => {
    const chip = render({ agentType: 'codex', usage: { ...base, model: 'gpt-5.5' }, plan: plan(23) })!;
    expect(chip.textContent).toBe('ctx 47%·plan 23%·↻ 2h19m');
  });

  it('Gemini (and any other agent) shows no chip', () => {
    expect(render({ agentType: 'gemini', usage: base, plan: plan(20) })).toBeNull();
    expect(render({ agentType: 'shell', usage: base })).toBeNull();
  });

  it('nothing to show → no chip', () => {
    expect(render({})).toBeNull();
    const onlyTok = { ...defaults, parts: defaults.parts.map((p) => ({ ...p, on: p.id === 'tok' })) };
    expect(render({ plan: plan(10), view: onlyTok })).toBeNull();
  });
});
