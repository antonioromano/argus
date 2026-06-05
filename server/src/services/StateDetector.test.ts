import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StateDetector } from './StateDetector.js';

const settle = (ms = 1000) => new Promise((r) => setTimeout(r, ms));

// The detector scans the BOTTOM ~15 rows, where a real TUI parks its input box —
// so push content down with newlines before the line under test.
const atBottom = (line: string) => '\r\n'.repeat(20) + line;

test('a visible claude input box settles to waiting', async () => {
  let status: string | null = null;
  const det = new StateDetector((s) => { status = s; }, 'claude');
  det.feed(atBottom('│ > '));
  await settle();
  assert.equal(status, 'waiting');
  det.destroy();
});

test('a (y/n) confirmation settles to waiting', async () => {
  let status: string | null = null;
  const det = new StateDetector((s) => { status = s; }, 'claude');
  det.feed(atBottom('Do you want to proceed? (y/n)'));
  await settle();
  assert.equal(status, 'waiting');
  det.destroy();
});

test('plain output with no prompt settles to idle', async () => {
  let status: string | null = null;
  const det = new StateDetector((s) => { status = s; }, 'claude');
  det.feed(atBottom('compiling modules, please wait'));
  await settle();
  assert.equal(status, 'idle');
  det.destroy();
});

test('setExited transitions to exited synchronously', () => {
  let status: string | null = null;
  const det = new StateDetector((s) => { status = s; }, 'claude');
  det.setExited();
  assert.equal(status, 'exited');
  det.destroy();
});

test('no status changes are emitted after destroy()', async () => {
  let count = 0;
  const det = new StateDetector(() => { count++; }, 'claude');
  det.destroy();
  det.feed(atBottom('│ > '));
  await settle(900);
  assert.equal(count, 0);
});

test('getLastPromptText extracts the question above the input box', async () => {
  const det = new StateDetector(() => {}, 'claude');
  det.feed(atBottom('Which file should I edit?\r\n│ > '));
  await settle();
  assert.equal(det.getLastPromptText(), 'Which file should I edit?');
  det.destroy();
});

test('getLastPromptText skips a bare file path and returns the question above it', async () => {
  const det = new StateDetector(() => {}, 'claude');
  det.feed(atBottom(
    'Which file should I edit?\r\n' +
    '/var/folders/s7/T/TemporaryItems/NSIRD_screencaptureui_GQo8sF/Screenshot 2026-06-05 at 10.11.33.png\r\n' +
    '│ > ',
  ));
  await settle();
  assert.equal(det.getLastPromptText(), 'Which file should I edit?');
  det.destroy();
});

test('getLastPromptText skips user-message echoes', async () => {
  const det = new StateDetector(() => {}, 'claude');
  det.feed(atBottom('I will update the config file.\r\n> fix the bug\r\n│ > '));
  await settle();
  assert.equal(det.getLastPromptText(), 'I will update the config file.');
  det.destroy();
});

test('getLastPromptText prefers a question-shaped line over nearer prose', async () => {
  const det = new StateDetector(() => {}, 'claude');
  det.feed(atBottom('Do you want me to continue?\r\nSome status line here\r\n│ > '));
  await settle();
  assert.equal(det.getLastPromptText(), 'Do you want me to continue?');
  det.destroy();
});

test('getLastPromptText returns undefined when only a path sits above the box', async () => {
  const det = new StateDetector(() => {}, 'claude');
  det.feed(atBottom('/tmp/foo/Screenshot 2026-06-05 at 10.11.33.png\r\n│ > '));
  await settle();
  assert.equal(det.getLastPromptText(), undefined);
  det.destroy();
});
