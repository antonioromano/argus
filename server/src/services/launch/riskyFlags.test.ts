import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagReviewReason, normalizeFlagName, UNRECOGNIZED } from './riskyFlags.js';

test('normalizeFlagName: case, dashes, underscores, --no- negation', () => {
  assert.equal(normalizeFlagName('--Approval_Mode=yolo'), 'approvalmode');
  assert.equal(normalizeFlagName('--approvalMode'), 'approvalmode');
  assert.equal(normalizeFlagName('--no-sandbox'), 'sandbox');
});

test('known-benign flags pass quietly, per agent', () => {
  assert.equal(flagReviewReason('claude', '--model=opus'), null);
  assert.equal(flagReviewReason('claude', '--verbose'), null);
  assert.equal(flagReviewReason('claude', '-c'), null); // claude: --continue
  assert.equal(flagReviewReason('gemini', '-m=gemini-2.5-pro'), null);
  assert.equal(flagReviewReason('codex', '--model=o3'), null);
});

// Each bypass of the old denylist.
test('yargs camelCase and --no- negation are caught (gemini)', () => {
  assert.notEqual(flagReviewReason('gemini', '--approvalMode=yolo'), null);
  assert.notEqual(flagReviewReason('gemini', '--includeDirectories=/'), null);
  assert.notEqual(flagReviewReason('gemini', '--no-sandbox'), null);
});

test('--allow-dangerously-skip-permissions is caught (claude)', () => {
  assert.equal(flagReviewReason('claude', '--allow-dangerously-skip-permissions'), 'disables safety checks');
});

test('short flags and clusters are checked letter by letter', () => {
  assert.match(flagReviewReason('codex', '-c') ?? '', /config/); // codex -c is NOT continue
  assert.match(flagReviewReason('gemini', '-s') ?? '', /sandbox/);
  assert.match(flagReviewReason('codex', '-a') ?? '', /approval/);
  assert.match(flagReviewReason('gemini', '-yf') ?? '', /yolo/);
  assert.match(flagReviewReason('claude', '-cx') ?? '', /-x/); // one bad letter is enough
});

test('--strict-mcp-config and any unknown flag are surfaced', () => {
  assert.notEqual(flagReviewReason('claude', '--strict-mcp-config'), null);
  assert.equal(flagReviewReason('claude', '--some-future-flag'), UNRECOGNIZED);
  assert.equal(flagReviewReason('my-custom-agent', '--model=x'), UNRECOGNIZED);
});
