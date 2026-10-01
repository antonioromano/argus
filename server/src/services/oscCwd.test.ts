import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OscCwdParser, parseFileUrl } from './oscCwd.js';

const osc7 = (p: string, end = '\x07') => `\x1b]7;file://mac.local${p}${end}`;

test('reads a BEL- or ST-terminated OSC 7 cwd and returns the last one in a chunk', () => {
  const p = new OscCwdParser();
  assert.equal(p.feed('plain output'), null);
  assert.equal(p.feed(`a${osc7('/Users/me/one')}b${osc7('/Users/me/two', '\x1b\\')}c`), '/Users/me/two');
});

test('completes a sequence split across chunks', () => {
  const p = new OscCwdParser();
  const seq = osc7('/Users/me/work/api');
  assert.equal(p.feed('prompt ' + seq.slice(0, 12)), null);
  assert.equal(p.feed(seq.slice(12) + '$ '), '/Users/me/work/api');
});

test('percent-decodes, and rejects non-file URLs', () => {
  assert.equal(parseFileUrl('file://h/Users/me/My%20Repo/50%25'), '/Users/me/My Repo/50%');
  assert.equal(parseFileUrl('file:///Users/me/bad%zz'), '/Users/me/bad%zz');
  assert.equal(parseFileUrl('https://example.com/x'), null);
});

test('drops an unterminated sequence that grows past the cap', () => {
  const p = new OscCwdParser();
  assert.equal(p.feed('\x1b]7;file://h/' + 'x'.repeat(5000)), null);
  assert.equal(p.feed('\x07'), null);
  assert.equal(p.feed(osc7('/ok')), '/ok');
});
