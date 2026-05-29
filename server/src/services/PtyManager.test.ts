import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { shquote, tmuxSessionName } from './PtyManager.js';

test('shquote wraps a plain string in single quotes', () => {
  assert.equal(shquote('claude'), "'claude'");
});

test('shquote neutralizes embedded single quotes', () => {
  assert.equal(shquote("a'b"), "'a'\\''b'");
});

// The real contract: whatever shquote produces, the shell must echo back verbatim —
// no metacharacter (;, $, `, newline, spaces) may break out of the quoted word.
for (const payload of [
  'plain',
  'with space',
  'semi;colon',
  '$(whoami)',
  '`id`',
  "quote'inside",
  'a"b',
  'new\nline',
  '--flag=value with spaces',
]) {
  test(`shquote is shell-safe for: ${JSON.stringify(payload)}`, () => {
    const out = execFileSync('/bin/sh', ['-c', `printf %s ${shquote(payload)}`], { encoding: 'utf-8' });
    assert.equal(out, payload);
  });
}

test('tmuxSessionName prefixes with argus- and keeps UUIDs intact', () => {
  assert.equal(
    tmuxSessionName('3f8a1c2e-0000-4444-8888-abcabcabcabc'),
    'argus-3f8a1c2e-0000-4444-8888-abcabcabcabc',
  );
});

test('tmuxSessionName strips characters tmux would mishandle', () => {
  assert.equal(tmuxSessionName('a b:c.d/e'), 'argus-abcde');
});
