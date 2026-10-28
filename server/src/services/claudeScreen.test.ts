import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  chatInputBytes,
  inputStillPending,
  permissionModeFromFooter,
  promptInputText,
  promptSuggestion,
  readScreenRows,
  type ScreenRow,
} from './claudeScreen.js';
import { TerminalMirror } from './TerminalMirror.js';

test('reads every mode Claude Code paints in its footer', () => {
  // Captured from Claude Code 2.1.309, cycling with Shift+Tab.
  const cases: Array<[string, string]> = [
    ['  ⏵⏵ auto mode on (shift+tab to cycle) · PR #51 · ← for agents', 'auto'],
    ['  ⏸ manual mode on · PR #51', 'default'],
    ['  ⏵⏵ accept edits on (shift+tab to cycle) · PR #51', 'acceptEdits'],
    ['  ⏸ plan mode on (shift+tab to cycle) · PR #51', 'plan'],
    ['  ⏵⏵ bypass permissions on (shift+tab to cycle)', 'bypassPermissions'],
  ];
  for (const [line, mode] of cases) {
    assert.equal(permissionModeFromFooter(['  Opus 5.5·1M medium', line]), mode, line);
  }
});

test('ignores mentions outside the footer and screens without one', () => {
  assert.equal(permissionModeFromFooter(['> turn plan mode on please', '❯ Try "fix lint errors"']), undefined);
  assert.equal(permissionModeFromFooter([]), undefined);
  assert.equal(permissionModeFromFooter(['  ? for shortcuts']), undefined);
});

test('the lowest footer line wins', () => {
  assert.equal(permissionModeFromFooter(['  ⏸ plan mode on', '  ⏵⏵ auto mode on']), 'auto');
});

test('finds the input box below echoed prompts', () => {
  const rows = ['❯ /model claude-sonnet-5-5', '  ⎿  Set model to Sonnet 5.5', '──────', '❯ /model claude-opus-5-5', '──────', '  ⏵⏵ auto mode on'];
  assert.equal(promptInputText(rows), '/model claude-opus-5-5');
  assert.equal(inputStillPending(rows, '/model claude-opus-5-5'), true);
  assert.equal(inputStillPending(['❯ /model claude-opus-5-5', '──', '❯ ', '──'], '/model claude-opus-5-5'), false, 'submitted: box is empty');
  assert.equal(inputStillPending(['❯ Try "fix lint errors"'], 'hello'), false, 'placeholder');
  assert.equal(inputStillPending(['❯ [Pasted text #1 +3 lines]'], 'a\nb\nc'), true);
  assert.equal(promptInputText(['no prompt here']), undefined);
});

test('chatInputBytes types one line as is and pastes multi-line text', () => {
  assert.equal(chatInputBytes('hello'), 'hello');
  assert.equal(chatInputBytes('a\r\nb\rc'), '\x1b[200~a\nb\nc\x1b[201~');
});

// Prompt suggestion (F9): screens captured from Claude Code 2.1.312 (120×30),
// serialized from a headless xterm, replayed here into one.
async function screen(name: string, edit: (ansi: string) => string = (s) => s): Promise<ScreenRow[]> {
  const ansi = readFileSync(new URL(`./__fixtures__/claude-screen/${name}.ansi`, import.meta.url), 'utf8');
  const mirror = new TerminalMirror(120, 30);
  await mirror.feed(edit(ansi));
  const rows = readScreenRows(mirror.term, 12);
  mirror.dispose();
  return rows;
}

test('reads the faint suggestion in the empty input box', async () => {
  assert.equal(promptSuggestion(await screen('suggestion')), 'commit it');
});

test('the same text in plain grey is no suggestion', async () => {
  const rows = await screen('suggestion', (s) => s.replace('\x1b[2mcommit it', '\x1b[38;2;153;153;153mcommit it'));
  assert.equal(promptSuggestion(rows), undefined);
});

test('typed input, an empty box mid-turn and the first-run placeholder are no suggestion', async () => {
  assert.equal(promptSuggestion(await screen('typed')), undefined);
  assert.equal(promptSuggestion(await screen('running')), undefined);
  assert.equal(promptSuggestion(await screen('placeholder')), undefined, 'Try "…" placeholder');
  assert.equal(promptSuggestion([]), undefined);
});

test('a suggestion continues on faint rows under the prompt; typed text before faint text is input', () => {
  const row = (text: string, dimFrom: number): ScreenRow => [...text].map((ch, i) => ({ ch, dim: i >= dimFrom }));
  assert.equal(promptSuggestion([row('❯ run the whole', 2), row('  test suite', 0), row('────', 99)]), 'run the whole test suite');
  assert.equal(promptSuggestion([row('❯ /com', 99).concat(row('mit', 0))]), undefined, 'autocomplete tail after typed text');
  assert.equal(promptSuggestion([row('❯ commit it', 2), row('──', 99), row('❯ 1. Yes', 99)]), undefined, 'the lowest prompt row decides');
});
