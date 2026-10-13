import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModelId, priceFor, turnCost, contextWindowFor, MODEL_PRICES } from './pricing.js';

const close = (a: number | undefined, b: number) => {
  assert.ok(a !== undefined, 'expected a price');
  assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
};
const turn = (o: Partial<Parameters<typeof turnCost>[1]> = {}) => ({
  input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, ...o,
});

test('normalizeModelId strips provider prefixes, tags and snapshot dates', () => {
  assert.equal(normalizeModelId('claude-opus-5-5'), 'claude-opus-5-5');
  assert.equal(normalizeModelId('claude-sonnet-4-5-20250929'), 'claude-sonnet-4-5');
  assert.equal(normalizeModelId('claude-opus-4-20250514'), 'claude-opus-4');
  assert.equal(normalizeModelId('us.anthropic.claude-opus-4-8-v1:0'), 'claude-opus-4-8');
  assert.equal(normalizeModelId('anthropic.claude-opus-5-5'), 'claude-opus-5-5');
  assert.equal(normalizeModelId('claude-opus-4-5@20251101'), 'claude-opus-4-5');
  assert.equal(normalizeModelId('Claude-Sonnet-4-5[1m]'), 'claude-sonnet-4-5');
});

test('every table entry has positive rates and a window', () => {
  for (const [id, p] of Object.entries(MODEL_PRICES)) {
    assert.ok(p.input > 0 && p.output > 0 && p.cacheRead > 0, id);
    assert.ok(p.contextWindow >= 200_000, id);
  }
});

test('turnCost prices input, output, cache reads and both cache-write TTLs', () => {
  // Opus 5.5: $4 in, $20 out, $0.20 cache read; 5m write 1.25× input, 1h write 2×.
  const usd = turnCost('claude-opus-5-5', turn({
    input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite5m: 1_000_000, cacheWrite1h: 1_000_000,
  }));
  close(usd, 4 + 20 + 0.2 + 5 + 8);
});

test('turnCost uses the long-prompt tier above its threshold', () => {
  close(turnCost('claude-haiku-5-5', turn({ input: 50_000, output: 1_000 })), (50_000 * 0.1 + 1_000 * 0.5) / 1e6);
  close(turnCost('claude-haiku-5-5', turn({ input: 150_000, output: 1_000 })), (150_000 * 0.5 + 1_000 * 2.5) / 1e6);
});

test('fast mode applies the known multiplier, and is unpriced where none is known', () => {
  close(turnCost('claude-opus-5-5', turn({ output: 1_000_000, speed: 'fast' })), 40);
  assert.equal(turnCost('claude-opus-4-8', turn({ output: 1, speed: 'fast' })), undefined);
});

test('unknown models get no price', () => {
  assert.equal(priceFor('gpt-5'), undefined);
  assert.equal(turnCost('claude-unknown-9', turn({ input: 10 })), undefined);
  assert.equal(turnCost(undefined, turn({ input: 10 })), undefined);
});

test('contextWindowFor: table window, bumped to 1M when a turn already exceeds it', () => {
  assert.equal(contextWindowFor('claude-opus-5-5', 10), 1_000_000);
  assert.equal(contextWindowFor('claude-sonnet-4-5-20250929', 150_000), 200_000);
  assert.equal(contextWindowFor('claude-sonnet-4-5-20250929', 250_000), 1_000_000);
  assert.equal(contextWindowFor('mystery', 10), undefined);
});
