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

test('a plan-approval menu rendered at the top of the screen settles to waiting', async () => {
  // Claude Code clears + homes before drawing the plan-approval UI, so the
  // prompt block sits at the TOP of the grid with blank rows below it. A
  // bottom-anchored scan window sees only blanks and misclassifies as idle.
  let status: string | null = null;
  const det = new StateDetector((s) => { status = s; }, 'claude');
  det.feed(
    [
      'Claude has written up a plan and is ready to execute. Would you like to proceed?',
      '',
      '❯ 1. Yes, and use auto mode',
      '  2. Yes, manually approve edits',
      '  3. No, refine with Ultraplan on Claude Code on the web',
      '  4. Tell Claude what to change',
      '     shift+tab to approve with this feedback',
      '',
      'ctrl-g to edit Vim · ~/.claude/plans/look-at-the-logs-synchronous-in-valley.md',
    ].join('\r\n'),
  );
  await settle();
  assert.equal(status, 'waiting');
  det.destroy();
});

test('getLastPromptText finds the question when the prompt block is at the top of the screen', async () => {
  const det = new StateDetector(() => {}, 'claude');
  det.feed(
    'Claude has written up a plan. Would you like to proceed?\r\n' +
    '❯ 1. Yes, and use auto mode\r\n' +
    '  2. No, tell Claude what to change\r\n',
  );
  await settle();
  assert.equal(det.getLastPromptText(), 'Claude has written up a plan. Would you like to proceed?');
  det.destroy();
});

test('getLastPromptText returns the question of a Bash permission dialog, not a menu option', async () => {
  const det = new StateDetector(() => {}, 'claude');
  det.feed(atBottom(
    [
      'Bash command',
      '  kill $(cat /tmp/claude-ui-preview/.server.pid) 2>/dev/null; rm',
      '  -rf /tmp/claude-ui-preview; echo cleaned',
      '  Kill preview server and clean up',
      '',
      'Contains command_substitution',
      '',
      'Do you want to proceed?',
      '❯ 1. Yes',
      '  2. No',
      '',
      'Esc to cancel · Tab to amend · ctrl+e to explain',
    ].join('\r\n'),
  ));
  await settle();
  assert.equal(det.getLastPromptText(), 'Do you want to proceed?');
  det.destroy();
});

test('getLastPromptText never returns a bare menu option row', async () => {
  const det = new StateDetector(() => {}, 'claude');
  det.feed(atBottom('  2. No\r\nEsc to cancel · Tab to amend · ctrl+e to explain'));
  await settle();
  assert.equal(det.getLastPromptText(), undefined);
  det.destroy();
});

test('getLastPromptText returns undefined when only a path sits above the box', async () => {
  const det = new StateDetector(() => {}, 'claude');
  det.feed(atBottom('/tmp/foo/Screenshot 2026-06-05 at 10.11.33.png\r\n│ > '));
  await settle();
  assert.equal(det.getLastPromptText(), undefined);
  det.destroy();
});
