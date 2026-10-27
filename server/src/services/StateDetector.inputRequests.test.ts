import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionStatus } from '@argus/shared';
import { StateDetector, parseNavMenu } from './StateDetector.js';
import { FakeClock } from './StateDetector.testClock.js';

/**
 * F13 — every way Claude Code asks for input, as captured from a real
 * `claude` 2.1.311 at 110×40 (2026-10-27; long paths shortened). For each
 * screen: the detector reads `waiting`, the menu's options (with checkbox /
 * free-text metadata) and the question the Chat prompt card shows.
 */
const RULE = '─'.repeat(110);
const DASH = '╌'.repeat(110);

const SCREENS = {
  trustFolder: [
    RULE,
    ' Accessing workspace:',
    '',
    ' /Users/me/code/proj',
    '',
    ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open',
    " source project, or work from your team). If not, take a moment to review what's in this folder first.",
    '',
    " Claude Code'll be able to read, edit, and execute files here.",
    '',
    ' Security guide',
    '',
    ' ❯ No, exit',
    '   Yes, I trust this folder',
    '',
    ' Enter to confirm · Esc to cancel',
  ],
  bashPermission: [
    '❯ Run the bash command: ls -la /tmp | head -3',
    '',
    '⏺ Listing first entries of /tmp',
    '  ⎿  $ ls -la /tmp | head -3',
    '',
    RULE,
    ' Bash command',
    ' Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
    ' List first entries of /tmp',
    DASH,
    ' ls -la /tmp | head -3',
    DASH,
    ' Do you want to proceed?',
    ' ❯ 1. Yes',
    '   2. Yes, allow reading from /private/tmp from this project',
    '   3. Yes, and switch to auto mode · auto mode handles these prompts for you',
    '   4. No',
    '',
    ' Esc to cancel · Tab to amend',
  ],
  editPermission: [
    '⏺ Update(notes.txt)',
    '',
    RULE,
    ' Edit file',
    ' notes.txt',
    DASH,
    ' 1 -hello',
    ' 1 +hi',
    DASH,
    ' Do you want to make this edit to notes.txt?',
    ' ❯ 1. Yes',
    '   2. Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session',
    '      (shift+tab)',
    '   3. No',
    '',
    ' Esc to cancel · Tab to amend',
  ],
  askSingle: [
    '❯ Use the AskUserQuestion tool to ask me ONE question: which color do I prefer (red, green, blue), single',
    '  choice, with short descriptions. Do nothing else.',
    RULE,
    ' ☐ Color',
    '',
    'Which color do you prefer?',
    '',
    '❯ 1. Red',
    '     A warm, bold color',
    '  2. Green',
    '     A calm, natural color',
    '  3. Blue',
    '     A cool, steady color',
    '  4. Type something.',
    RULE,
    '  5. Chat about this',
    '',
    'Enter to select · ↑/↓ to navigate · Esc to cancel',
  ],
  askMultiSelectTab: [
    '❯ Use the AskUserQuestion tool ONCE with TWO questions: (1) "Which fruits do you like?" multiSelect true,',
    '  options apple, pear, kiwi; (2) "Which size?" single choice, options small, large. Do nothing else.',
    RULE,
    '←  ☒ Fruits  ☐ Size  ✔ Submit  →',
    '',
    'Which fruits do you like?',
    '',
    '❯ 1. [✔] Apple',
    '         Crisp and sweet',
    '  2. [ ] Pear',
    '         Soft and juicy',
    '  3. [✔] Kiwi',
    '         Tart and fuzzy',
    '  4. [ ] Type something',
    '     Next',
    RULE,
    '  5. Chat about this',
    '',
    'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
  ],
  askSecondTab: [
    '❯ Use the AskUserQuestion tool ONCE with TWO questions: (1) "Which fruits do you like?" multiSelect true,',
    '  options apple, pear, kiwi; (2) "Which size?" single choice, options small, large. Do nothing else.',
    RULE,
    '←  ☒ Fruits  ☐ Size  ✔ Submit  →',
    '',
    'Which size?',
    '',
    '❯ 1. Small',
    '     The smaller option',
    '  2. Large',
    '     The bigger option',
    '  3. Type something.',
    RULE,
    '  4. Chat about this',
    '',
    'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
  ],
  askReview: [
    RULE,
    '←  ☒ Fruits  ☒ Size  ✔ Submit  →',
    '',
    'Review your answers',
    '',
    ' ● Which fruits do you like?',
    '   → Apple, Kiwi',
    ' ● Which size?',
    '   → Large',
    '',
    'Ready to submit your answers?',
    '',
    '❯ 1. Submit answers',
    '  2. Cancel',
  ],
  planApproval: [
    '  ' + '─'.repeat(106),
    '   Claude has written up a plan and is ready to execute. Would you like to proceed?',
    '',
    '   ❯ 1. Yes, and use auto mode',
    '     2. Yes, manually approve edits',
    '     3. Tell Claude what to change',
    '        shift+tab to approve with this feedback',
    '',
    '   ctrl+g to edit in Vim · ~/.claude/plans/plan-add-a-line-shimmering-biscuit.md',
  ],
};

async function read(rows: string[]) {
  let status: SessionStatus | null = null;
  const clock = new FakeClock();
  const det = new StateDetector((s) => { status = s; }, 'claude', 110, 40, undefined, clock);
  det.feed(rows.join('\r\n'));
  await clock.advance(900);
  const out = { status, menu: det.getMenu(), question: det.getLastPromptText() };
  det.destroy();
  return out;
}

test('trust-folder prompt: unnumbered options, answered with arrows from the cursor', async () => {
  const r = await read(SCREENS.trustFolder);
  assert.equal(r.status, 'waiting');
  assert.deepEqual(r.menu, {
    options: [{ key: '1', label: 'No, exit' }, { key: '2', label: 'Yes, I trust this folder' }],
    cursor: 0,
  });
  assert.equal(r.question, 'Quick safety check: Is this a project you created or one you trust?');
});

test('trust-folder prompt with the cursor moved down', () => {
  const rows = SCREENS.trustFolder.map((l) =>
    l === ' ❯ No, exit' ? '   No, exit' : l === '   Yes, I trust this folder' ? ' ❯ Yes, I trust this folder' : l);
  assert.equal(parseNavMenu(rows)?.cursor, 1);
});

test('Bash permission prompt', async () => {
  const r = await read(SCREENS.bashPermission);
  assert.equal(r.status, 'waiting');
  assert.equal(r.menu?.cursor, undefined);
  assert.deepEqual(r.menu?.options.map((o) => o.label), [
    'Yes',
    'Yes, allow reading from /private/tmp from this project',
    'Yes, and switch to auto mode · auto mode handles these prompts for you',
    'No',
  ]);
  assert.equal(r.question, 'Do you want to proceed?');
});

test('Edit permission prompt (wrapped option label keeps its first row)', async () => {
  const r = await read(SCREENS.editPermission);
  assert.equal(r.status, 'waiting');
  assert.deepEqual(r.menu?.options.map((o) => o.key), ['1', '2', '3']);
  assert.ok(r.menu?.options[1]!.label.startsWith('Yes, and switch to accept edits'));
  assert.equal(r.question, 'Do you want to make this edit to notes.txt?');
});

test('AskUserQuestion, single choice: the "Type something." option is free text', async () => {
  const r = await read(SCREENS.askSingle);
  assert.equal(r.status, 'waiting');
  assert.deepEqual(r.menu?.options, [
    { key: '1', label: 'Red' },
    { key: '2', label: 'Green' },
    { key: '3', label: 'Blue' },
    { key: '4', label: 'Type something.', freeText: true },
    { key: '5', label: 'Chat about this' },
  ]);
  assert.equal(r.question, 'Which color do you prefer?');
});

test('AskUserQuestion, multiSelect tab: checkboxes are read with their state', async () => {
  const r = await read(SCREENS.askMultiSelectTab);
  assert.equal(r.status, 'waiting');
  assert.deepEqual(r.menu?.options, [
    { key: '1', label: 'Apple', checked: true },
    { key: '2', label: 'Pear', checked: false },
    { key: '3', label: 'Kiwi', checked: true },
    { key: '4', label: 'Type something', checked: false, freeText: true },
    { key: '5', label: 'Chat about this' },
  ]);
  // Not the user's echoed request above it, though that also contains a "?".
  assert.equal(r.question, 'Which fruits do you like?');
});

test('AskUserQuestion, second tab of several questions', async () => {
  const r = await read(SCREENS.askSecondTab);
  assert.equal(r.status, 'waiting');
  assert.deepEqual(r.menu?.options.map((o) => o.label), ['Small', 'Large', 'Type something.', 'Chat about this']);
  assert.equal(r.question, 'Which size?');
});

test('AskUserQuestion review step (no footer on screen)', async () => {
  const r = await read(SCREENS.askReview);
  assert.equal(r.status, 'waiting');
  assert.deepEqual(r.menu?.options.map((o) => o.label), ['Submit answers', 'Cancel']);
  assert.equal(r.question, 'Ready to submit your answers?');
});

test('ExitPlanMode approval: "Tell Claude what to change" is free text', async () => {
  const r = await read(SCREENS.planApproval);
  assert.equal(r.status, 'waiting');
  assert.deepEqual(r.menu?.options, [
    { key: '1', label: 'Yes, and use auto mode' },
    { key: '2', label: 'Yes, manually approve edits' },
    { key: '3', label: 'Tell Claude what to change', freeText: true },
  ]);
  assert.equal(r.question, 'Claude has written up a plan and is ready to execute. Would you like to proceed?');
});

test('the input box alone is not an unnumbered menu', () => {
  assert.equal(parseNavMenu([RULE, '❯ Try "how do I log an error?"', RULE, '  ⏵⏵ auto mode on (shift+tab to cycle)']), undefined);
  // Misaligned rows, two cursors, or numbered rows are not one either.
  assert.equal(parseNavMenu(['❯ A', '      B', '', 'Enter to confirm']), undefined);
  assert.equal(parseNavMenu(['❯ A', '❯ B', '', 'Enter to confirm']), undefined);
  assert.equal(parseNavMenu(['❯ 1. A', '  2. B', '', 'Enter to confirm']), undefined);
});
