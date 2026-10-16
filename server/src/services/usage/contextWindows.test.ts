import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModelId, contextWindowFor, MODEL_CONTEXT_WINDOWS } from './contextWindows.js';

test('normalizeModelId strips provider prefixes, tags and snapshot dates', () => {
  assert.equal(normalizeModelId('claude-opus-5-5'), 'claude-opus-5-5');
  assert.equal(normalizeModelId('claude-sonnet-4-5-20250929'), 'claude-sonnet-4-5');
  assert.equal(normalizeModelId('claude-opus-4-20250514'), 'claude-opus-4');
  assert.equal(normalizeModelId('us.anthropic.claude-opus-4-8-v1:0'), 'claude-opus-4-8');
  assert.equal(normalizeModelId('anthropic.claude-opus-5-5'), 'claude-opus-5-5');
  assert.equal(normalizeModelId('claude-opus-4-5@20251101'), 'claude-opus-4-5');
  assert.equal(normalizeModelId('Claude-Sonnet-4-5[1m]'), 'claude-sonnet-4-5');
});

test('every table entry has a window of at least 200k', () => {
  for (const [id, w] of Object.entries(MODEL_CONTEXT_WINDOWS)) assert.ok(w >= 200_000, id);
});

test('contextWindowFor: table window, bumped to 1M when a turn already exceeds it', () => {
  assert.equal(contextWindowFor('claude-opus-5-5', 10), 1_000_000);
  assert.equal(contextWindowFor('claude-sonnet-4-5-20250929', 150_000), 200_000);
  assert.equal(contextWindowFor('claude-sonnet-4-5-20250929', 250_000), 1_000_000);
  assert.equal(contextWindowFor('mystery', 10), undefined);
  assert.equal(contextWindowFor(undefined, 300_000), 1_000_000);
});
