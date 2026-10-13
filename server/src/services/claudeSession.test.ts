import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResumeFlags, isClaudeSessionId } from './claudeSession.js';

const ID = '0b0e7a3c-1f2d-4e5f-8a9b-0c1d2e3f4a5b';

test('isClaudeSessionId accepts only canonical UUIDs', () => {
  assert.equal(isClaudeSessionId(ID), true);
  assert.equal(isClaudeSessionId(ID.toUpperCase()), true);
  for (const bad of ['', '--help', `${ID} --dangerously-skip-permissions`, `${ID};rm -rf ~`, `$(${ID})`, ID.slice(1), `${ID}\n`, 42, null, undefined]) {
    assert.equal(isClaudeSessionId(bad), false, String(bad));
  }
});

test('buildResumeFlags puts --resume <id> first and keeps the user flags', () => {
  assert.deepEqual(buildResumeFlags(['--model', 'opus', '--verbose'], ID), ['--resume', ID, '--model', 'opus', '--verbose']);
  assert.deepEqual(buildResumeFlags([], ID), ['--resume', ID]);
});

test('buildResumeFlags drops conversation-selecting flags the user stored', () => {
  assert.deepEqual(
    buildResumeFlags(['--continue', '-c', '--resume', 'old', '-r', 'older', '--session-id', 'x', '--resume=y', '--session-id=z', '--model', 'opus'], ID),
    ['--resume', ID, '--model', 'opus'],
  );
  // A bare --resume (picker) is dropped without eating the next flag.
  assert.deepEqual(buildResumeFlags(['--resume', '--verbose'], ID), ['--resume', ID, '--verbose']);
});

test('buildResumeFlags refuses an id that is not a UUID', () => {
  assert.throws(() => buildResumeFlags([], '--dangerously-skip-permissions'), /Invalid Claude session id/);
  assert.throws(() => buildResumeFlags([], `${ID} x`), /Invalid Claude session id/);
});
