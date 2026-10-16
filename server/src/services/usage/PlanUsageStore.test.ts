import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlanUsage, PlanUsageAgent } from '@argus/shared';
import { PlanUsageStore, effectivePlan, epochSecondsToMs, parseClaudeRateLimits } from './PlanUsageStore.js';

const NOW = 1_800_000_000_000;

test('parses Claude status line rate_limits (epoch seconds → ms)', () => {
  const p = parseClaudeRateLimits({
    five_hour: { used_percentage: 20.46, resets_at: 1_800_003_600 },
    seven_day: { used_percentage: 3, resets_at: 1_800_300_000 },
  }, NOW)!;
  assert.deepEqual(p, {
    observedAt: NOW,
    primary: { usedPct: 20.5, resetsAt: 1_800_003_600_000, windowMinutes: 300 },
    secondary: { usedPct: 3, resetsAt: 1_800_300_000_000, windowMinutes: 10080 },
  });
});

test('rejects malformed rate_limits; one window alone is enough', () => {
  assert.equal(parseClaudeRateLimits(null, NOW), null);
  assert.equal(parseClaudeRateLimits([], NOW), null);
  assert.equal(parseClaudeRateLimits({ five_hour: { used_percentage: 'x' } }, NOW), null);
  assert.equal(parseClaudeRateLimits({ five_hour: { used_percentage: -1 } }, NOW), null);
  const only7 = parseClaudeRateLimits({ seven_day: { used_percentage: 150, resets_at: 'soon' } }, NOW)!;
  assert.deepEqual(only7.secondary, { usedPct: 100, windowMinutes: 10080 }, 'clamped, bad reset dropped');
  assert.equal(only7.primary, undefined);
  assert.equal(epochSecondsToMs(1_800_000_000_000), undefined, 'ms is not seconds');
});

test('a window whose reset time passed shows as reset (0%)', () => {
  const p: PlanUsage = {
    observedAt: NOW - 10,
    primary: { usedPct: 80, resetsAt: NOW - 1, windowMinutes: 300 },
    secondary: { usedPct: 40, resetsAt: NOW + 1000, windowMinutes: 10080 },
  };
  const e = effectivePlan(p, NOW);
  assert.deepEqual(e.primary, { usedPct: 0, windowMinutes: 300, reset: true });
  assert.deepEqual(e.secondary, p.secondary);
});

test('store: per agent, newest reading wins, emits only on change', () => {
  let now = NOW;
  const events: [PlanUsageAgent, PlanUsage][] = [];
  const store = new PlanUsageStore((a, p) => events.push([a, p]), () => now);
  const r1: PlanUsage = { observedAt: NOW, primary: { usedPct: 10, resetsAt: NOW + 3_600_000, windowMinutes: 300 } };
  assert.equal(store.update('claude', r1), true);
  assert.equal(store.update('claude', { ...r1, observedAt: NOW + 5 }), false, 'same numbers: no event');
  assert.equal(store.update('claude', { observedAt: NOW - 100, primary: { usedPct: 99 } }), false, 'older reading ignored');
  assert.equal(store.get('claude')!.primary!.usedPct, 10);
  assert.equal(store.get('codex'), undefined, 'accounts are separate');

  // A reading that leaves a window out keeps the previous one.
  store.update('claude', { observedAt: NOW + 10, secondary: { usedPct: 5, windowMinutes: 10080 } });
  assert.equal(store.get('claude')!.primary!.usedPct, 10);
  assert.equal(store.get('claude')!.secondary!.usedPct, 5);

  // Time passes the reset: shown as 0% until a fresh value.
  now = NOW + 3_600_001;
  assert.equal(store.get('claude')!.primary!.usedPct, 0);
  assert.equal(store.all().claude!.primary!.reset, true);
  store.update('claude', { observedAt: now, primary: { usedPct: 2, resetsAt: now + 18_000_000, windowMinutes: 300 } });
  assert.equal(store.get('claude')!.primary!.usedPct, 2);
  assert.equal(events.length, 3);
});
