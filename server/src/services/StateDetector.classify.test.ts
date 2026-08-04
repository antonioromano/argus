import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionStatus } from '@argus/shared';
import { StateDetector } from './StateDetector.js';
import { FakeClock } from './StateDetector.testClock.js';

// Split out of StateDetector.test.ts: these settle-heavy classifier tests run
// sequentially within a file, and combined with the base suite they exceeded
// node:test's 30s per-file timeout in CI. Kept in their own file so each stays
// well under budget. settle waits past the detector's commit latency
// (IDLE_SETTLE_MS 500 + DEBOUNCE_MS 300 = 800ms).
const atBottom = (line: string) => '\r\n'.repeat(20) + line;

// --- Working-indicator detection (current Claude Code footer) --------------
// Claude shows a low-volume "<verb>… (<elapsed> · ↑/↓ <n> tokens)" spinner
// line while working. It's a single slowly-redrawn row, so the feed-count
// activity heuristic misses it and the old detector settled to idle.

// Helper: the detector starts internally 'running', so asserting a working
// footer keeps it running would observe no transition (callback never fires).
// Drive it to idle first, then the working footer is an observable idle→running.
const toIdle = async (det: StateDetector, settle: () => Promise<void>) => {
  det.feed(atBottom('build complete, nothing pending'));
  await settle();
};


/**
 * Each test gets its own virtual clock, so `settle()` fires the detector's
 * chained timers (500ms idle settle → 300ms commit debounce) instead of sleeping
 * past them. Sleeping was flaky: under load the real timers fire late and the
 * sleep expires first, so a correct classification reads as a wrong one.
 */
function make(onStatus: (s: SessionStatus) => void, agentType = 'claude') {
  const clock = new FakeClock();
  const det = new StateDetector(onStatus, agentType, 120, 30, undefined, clock);
  return { det, clock, settle: (ms = 900) => clock.advance(ms) };
}

test('a low-volume working footer settles to running, not idle', async () => {
  let status: string | null = null;
  const { det, settle } = make((s) => { status = s; }, 'claude');
  await toIdle(det, settle);
  assert.equal(status, 'idle');
  det.feed(atBottom('✳ Crafting… (20s · ↓ 540 tokens)'));
  await settle();
  assert.equal(status, 'running');
  det.destroy();
});

test('an elapsed working footer with minutes settles to running', async () => {
  let status: string | null = null;
  const { det, settle } = make((s) => { status = s; }, 'claude');
  await toIdle(det, settle);
  det.feed(atBottom('■ Low-batch sweep… (16m 43s · ↑ 37.0k tokens)'));
  await settle();
  assert.equal(status, 'running');
  det.destroy();
});

test('the "esc to interrupt" hint settles to running', async () => {
  let status: string | null = null;
  const { det, settle } = make((s) => { status = s; }, 'claude');
  await toIdle(det, settle);
  det.feed(atBottom('Thinking… (esc to interrupt)'));
  await settle();
  assert.equal(status, 'running');
  det.destroy();
});

test('prose mentioning "tokens" without a counter shape does not read as running', async () => {
  let status: string | null = null;
  const { det, settle } = make((s) => { status = s; }, 'claude');
  det.feed(atBottom('This limits the number of tokens per request.'));
  await settle();
  assert.equal(status, 'idle');
  det.destroy();
});

test('gemini has no working patterns, so a claude-style footer does not force running', async () => {
  let status: string | null = null;
  const { det, settle } = make((s) => { status = s; }, 'gemini');
  det.feed(atBottom('✳ Crafting… (20s · ↓ 540 tokens)'));
  await settle();
  assert.equal(status, 'idle');
  det.destroy();
});

// --- Tri-state matrix: box + working / box + menu / box alone --------------

test('input box + working footer → running (working overrides the box)', async () => {
  let status: string | null = null;
  const { det, settle } = make((s) => { status = s; }, 'claude');
  await toIdle(det, settle);
  det.feed(atBottom('✳ Crafting… (20s · ↓ 540 tokens)\r\n│ > '));
  await settle();
  assert.equal(status, 'running');
  det.destroy();
});

test('input box + real menu → waiting', async () => {
  let status: string | null = null;
  const { det, settle } = make((s) => { status = s; }, 'claude');
  det.feed(atBottom('Do you want to proceed? (y/n)\r\n│ > '));
  await settle();
  assert.equal(status, 'waiting');
  det.destroy();
});

// --- Captured real-world misclassification cases ---------------------------

test('Jun-5: approval menu with trickling output reads as waiting, not running', async () => {
  let status: string | null = null;
  const { det, settle } = make((s) => { status = s; }, 'claude');
  det.feed(atBottom(
    [
      'Would you like to proceed?',
      '',
      '❯ 1. Yes, and use auto mode',
      '  2. Yes, manually approve edits',
      '  3. No, refine',
      '  4. Tell Claude what to change',
    ].join('\r\n'),
  ));
  await settle();
  assert.equal(status, 'waiting');
  det.destroy();
});

test('Jul-7-left: subagent running with input box on screen reads as running', async () => {
  let status: string | null = null;
  const { det, settle } = make((s) => { status = s; }, 'claude');
  await toIdle(det, settle);
  det.feed(atBottom(
    [
      'Running 1 shell command…',
      '✳ Consolidating shared components… (32m · ↑ 12.0k tokens)',
      '│ > ',
    ].join('\r\n'),
  ));
  await settle();
  assert.equal(status, 'running');
  det.destroy();
});

test('a finished session (working footer replaced by a bare box) settles to idle', async () => {
  // Protects the running → idle → done promotion path in SessionManager: when
  // work finishes the working footer disappears and only the box remains.
  let status: string | null = null;
  const { det, settle } = make((s) => { status = s; }, 'claude');
  await toIdle(det, settle);
  det.feed(atBottom('✳ Crafting… (20s · ↓ 540 tokens)'));
  await settle();
  assert.equal(status, 'running');
  det.feed('\x1b[2J\x1b[H' + atBottom('│ > '));
  await settle();
  assert.equal(status, 'idle');
  det.destroy();
});
