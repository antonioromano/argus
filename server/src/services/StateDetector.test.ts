import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StateDetector } from './StateDetector.js';

const settle = (ms = 1000) => new Promise((r) => setTimeout(r, ms));

// The detector scans the BOTTOM ~15 rows, where a real TUI parks its input box —
// so push content down with newlines before the line under test.
const atBottom = (line: string) => '\r\n'.repeat(20) + line;

test('a bare claude input box (no menu, no working footer) settles to idle', async () => {
  // The input box is ALWAYS on screen in current Claude Code — idle, working,
  // and waiting alike — so it is not a waiting signal on its own. A finished
  // session showing only the box must read as idle (→ done promotion), not
  // waiting.
  let status: string | null = null;
  const det = new StateDetector((s) => { status = s; }, 'claude');
  det.feed(atBottom('│ > '));
  await settle();
  assert.equal(status, 'idle');
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

test('getLastPromptText extracts the question from a multi-tab AskUserQuestion menu', async () => {
  // Real screen from 2026-06-05: tabbed AskUserQuestion with long option
  // descriptions — the question sits ~13 rows above the footer.
  const det = new StateDetector(() => {}, 'claude');
  det.feed(
    [
      'Planning: /Users/macbookpro10/.claude/plans/i-want-to-work-reactive-parnas.md',
      '',
      '←  ☐ Approach  ☐ Auto-ack  ✓ Submit  →',
      '',
      'Which shape for the done status?',
      '',
      "❯ 1. A: new 'done' status (Recommended)",
      "     Add 'done' as 5th SessionStatus value. running → settled → done (green). Focus session → server",
      '     flips to idle. One key added to existing status maps, all UI components pick it up.',
      '  2. B: unseen flag beside status',
      '     Keep 4 statuses, add unseenDone boolean to SessionInfo. More touch points in UI, but StateDetector',
      '     stays purely screen-derived and flag extends to other statuses later.',
      '  3. Type something.',
      '',
      '  4. Chat about this',
      '',
      'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
    ].join('\r\n'),
  );
  await settle();
  assert.equal(det.getLastPromptText(), 'Which shape for the done status?');
  det.destroy();
});

test('getLastPromptText reaches a question more than 15 rows above the footer', async () => {
  // Extraction uses a deeper window (25 rows) than state detection (15) —
  // tall menus with wrapped descriptions push the question out of the
  // 15-row window.
  const filler = (n: number) =>
    Array.from({ length: n }, (_, i) => `     details about this option, line ${i + 1}`);
  const det = new StateDetector(() => {}, 'claude');
  det.feed(
    [
      'Which approach should we take?',
      '',
      '❯ 1. Option A',
      ...filler(3),
      '  2. Option B',
      ...filler(3),
      '  3. Option C',
      ...filler(3),
      '  4. Option D',
      ...filler(3),
      '',
      'Enter to select · Esc to cancel',
    ].join('\r\n'),
  );
  await settle();
  assert.equal(det.getLastPromptText(), 'Which approach should we take?');
  det.destroy();
});

test('a writeQueue rejection does not freeze subsequent status detection', async () => {
  let status: string | null = null;
  const det = new StateDetector((s) => { status = s; }, 'claude');
  const term = (det as any).term;
  const originalWrite = term.write.bind(term);
  term.write = () => { throw new Error('simulated corrupted write'); };

  det.feed(atBottom('this write blows up'));
  await settle(100);
  assert.equal(status, null, 'the failed write should not have produced a status');

  term.write = originalWrite;
  det.feed(atBottom('Do you want to proceed? (y/n)'));
  await settle();
  assert.equal(status, 'waiting', 'detection must recover after a prior write rejected');
  det.destroy();
});

test('onPromptUpdate fires when the menu paints after a cursor-hint waiting transition', async () => {
  // DECSCUSR can flip status to waiting BEFORE the menu is painted; the
  // one-shot extraction at the transition then returns undefined. A later
  // repaint must surface the question via onPromptUpdate — and a transient
  // blank repaint must never downgrade it back to undefined.
  let status: string | null = null;
  const updates: string[] = [];
  const det = new StateDetector((s) => { status = s; }, 'claude');
  det.setOnPromptUpdate((text) => updates.push(text));

  // 1. Cursor-style hint only — waiting with nothing extractable on screen.
  det.feed('\x1b[5 q');
  await settle();
  assert.equal(status, 'waiting');
  assert.equal(det.getLastPromptText(), undefined);
  assert.deepEqual(updates, []);

  // 2. Menu paints while already waiting — update fires with the question.
  //    (A real menu, not a bare box: the box alone is no longer a prompt.)
  det.feed('Which file should I edit?\r\n❯ 1. src/a.ts\r\n  2. src/b.ts');
  await settle();
  assert.deepEqual(updates, ['Which file should I edit?']);

  // 3. Transient blank repaint (clear + cursor hint keeps waiting) — no
  //    undefined downgrade, no duplicate update.
  det.feed('\x1b[2J\x1b[H\x1b[5 q');
  await settle();
  assert.deepEqual(updates, ['Which file should I edit?']);
  det.destroy();
});

// --- Working-indicator detection (current Claude Code footer) --------------
// Claude shows a low-volume "<verb>… (<elapsed> · ↑/↓ <n> tokens)" spinner
// line while working. It's a single slowly-redrawn row, so the feed-count
// activity heuristic misses it and the old detector settled to idle.

// Helper: the detector starts internally 'running', so asserting a working
// footer keeps it running would observe no transition (callback never fires).
// Drive it to idle first, then the working footer is an observable idle→running.
const toIdle = async (det: StateDetector) => {
  det.feed(atBottom('build complete, nothing pending'));
  await settle();
};

test('a low-volume working footer settles to running, not idle', async () => {
  let status: string | null = null;
  const det = new StateDetector((s) => { status = s; }, 'claude');
  await toIdle(det);
  assert.equal(status, 'idle');
  det.feed(atBottom('✳ Crafting… (20s · ↓ 540 tokens)'));
  await settle();
  assert.equal(status, 'running');
  det.destroy();
});

test('an elapsed working footer with minutes settles to running', async () => {
  let status: string | null = null;
  const det = new StateDetector((s) => { status = s; }, 'claude');
  await toIdle(det);
  det.feed(atBottom('■ Low-batch sweep… (16m 43s · ↑ 37.0k tokens)'));
  await settle();
  assert.equal(status, 'running');
  det.destroy();
});

test('the "esc to interrupt" hint settles to running', async () => {
  let status: string | null = null;
  const det = new StateDetector((s) => { status = s; }, 'claude');
  await toIdle(det);
  det.feed(atBottom('Thinking… (esc to interrupt)'));
  await settle();
  assert.equal(status, 'running');
  det.destroy();
});

test('prose mentioning "tokens" without a counter shape does not read as running', async () => {
  let status: string | null = null;
  const det = new StateDetector((s) => { status = s; }, 'claude');
  det.feed(atBottom('This limits the number of tokens per request.'));
  await settle();
  assert.equal(status, 'idle');
  det.destroy();
});

test('gemini has no working patterns, so a claude-style footer does not force running', async () => {
  let status: string | null = null;
  const det = new StateDetector((s) => { status = s; }, 'gemini');
  det.feed(atBottom('✳ Crafting… (20s · ↓ 540 tokens)'));
  await settle();
  assert.equal(status, 'idle');
  det.destroy();
});

// --- Tri-state matrix: box + working / box + menu / box alone --------------

test('input box + working footer → running (working overrides the box)', async () => {
  let status: string | null = null;
  const det = new StateDetector((s) => { status = s; }, 'claude');
  await toIdle(det);
  det.feed(atBottom('✳ Crafting… (20s · ↓ 540 tokens)\r\n│ > '));
  await settle();
  assert.equal(status, 'running');
  det.destroy();
});

test('input box + real menu → waiting', async () => {
  let status: string | null = null;
  const det = new StateDetector((s) => { status = s; }, 'claude');
  det.feed(atBottom('Do you want to proceed? (y/n)\r\n│ > '));
  await settle();
  assert.equal(status, 'waiting');
  det.destroy();
});

// --- Captured real-world misclassification cases ---------------------------

test('Jun-5: approval menu with trickling output reads as waiting, not running', async () => {
  let status: string | null = null;
  const det = new StateDetector((s) => { status = s; }, 'claude');
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
  const det = new StateDetector((s) => { status = s; }, 'claude');
  await toIdle(det);
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
  const det = new StateDetector((s) => { status = s; }, 'claude');
  await toIdle(det);
  det.feed(atBottom('✳ Crafting… (20s · ↓ 540 tokens)'));
  await settle();
  assert.equal(status, 'running');
  det.feed('\x1b[2J\x1b[H' + atBottom('│ > '));
  await settle();
  assert.equal(status, 'idle');
  det.destroy();
});
