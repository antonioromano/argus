import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionUsage } from '@argus/shared';
import { UsageChip } from './UsageChip.js';

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

const base: SessionUsage = {
  inputTokens: 10, outputTokens: 10, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 20, updatedAt: 0,
};

describe('UsageChip', () => {
  it('shows context % with its level and the cost', () => {
    act(() => root.render(<UsageChip usage={{ ...base, contextPct: 87.4, contextTokens: 874_000, contextWindow: 1_000_000, costUsd: 2.5 }} />));
    const ctx = container.querySelector('.argus-usage-ctx')!;
    expect(ctx.textContent).toBe('87%');
    expect(ctx.getAttribute('data-level')).toBe('high');
    expect(container.querySelector('.argus-usage-cost')!.textContent).toBe('$2.50');
  });

  it('falls back to total tokens and no cost for an unknown model', () => {
    act(() => root.render(<UsageChip usage={{ ...base, totalTokens: 12_345 }} />));
    expect(container.querySelector('.argus-usage-ctx')!.textContent).toBe('12k');
    expect(container.querySelector('.argus-usage-cost')).toBeNull();
  });

  it('marks a partial cost', () => {
    act(() => root.render(<UsageChip usage={{ ...base, costUsd: 1, costPartial: true }} />));
    expect(container.querySelector('.argus-usage-cost')!.textContent).toBe('$1.00+');
  });
});
