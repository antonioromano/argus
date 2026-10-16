import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFolderTrusted, resolveUserStatusLine, statusLineFrom } from './userStatusLine.js';

const files = (map: Record<string, unknown>) => (p: string): string => {
  if (p in map) return typeof map[p] === 'string' ? (map[p] as string) : JSON.stringify(map[p]);
  throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
};
const sl = (command: string, extra: Record<string, unknown> = {}) => ({ statusLine: { type: 'command', command, ...extra } });
const opts = (map: Record<string, unknown>, env: NodeJS.ProcessEnv = {}) => ({
  readFileSync: files(map), realpathSync: (p: string) => p, home: '/home/u', env,
});
const TRUSTED = { '/home/u/.claude.json': { projects: { '/repo': { hasTrustDialogAccepted: true } } } };

test('precedence: settings.local.json > project settings.json > user settings.json', () => {
  const all = {
    ...TRUSTED,
    '/repo/.claude/settings.local.json': sl('local'),
    '/repo/.claude/settings.json': sl('project'),
    '/home/u/.claude/settings.json': sl('user'),
  };
  assert.equal(resolveUserStatusLine('/repo', opts(all))?.command, 'local');
  const { ['/repo/.claude/settings.local.json']: _l, ...noLocal } = all;
  assert.equal(resolveUserStatusLine('/repo', opts(noLocal))?.command, 'project');
  assert.equal(resolveUserStatusLine('/repo', opts({ '/home/u/.claude/settings.json': sl('user') }))?.command, 'user');
  assert.equal(resolveUserStatusLine('/repo', opts({})), undefined);
});

test('a file without a usable statusLine, or malformed, falls through to the next', () => {
  const r = resolveUserStatusLine('/repo', opts({
    ...TRUSTED,
    '/repo/.claude/settings.local.json': '{ not json',
    '/repo/.claude/settings.json': { model: 'opus', statusLine: { type: 'static', command: 'x' } },
    '/home/u/.claude/settings.json': sl('user'),
  }));
  assert.equal(r?.command, 'user');
});

test('CLAUDE_CONFIG_DIR replaces ~/.claude for the user settings file', () => {
  const r = resolveUserStatusLine('/repo', opts({ '/cfg/settings.json': sl('cfgdir'), '/home/u/.claude/settings.json': sl('home') }, { CLAUDE_CONFIG_DIR: '/cfg' }));
  assert.equal(r?.command, 'cfgdir');
});

test('statusLineFrom keeps padding and rejects empty or odd commands', () => {
  assert.deepEqual(statusLineFrom(sl(' x ', { padding: 1 })), { command: 'x', padding: 1 });
  assert.equal(statusLineFrom(sl('   ')), undefined);
  assert.equal(statusLineFrom(sl('a\0b')), undefined);
  assert.equal(statusLineFrom({ statusLine: 'echo hi' }), undefined);
  assert.equal(statusLineFrom(null), undefined);
  assert.deepEqual(statusLineFrom(sl('x', { padding: -1 })), { command: 'x' });
});

// ── Workspace trust ─────────────────────────────────────────────────────────

const project = { '/repo/.claude/settings.json': sl('project'), '/home/u/.claude/settings.json': sl('user') };

test('untrusted folder: a project statusLine is ignored, the user-level one is used', () => {
  const untrusted = { '/home/u/.claude.json': { projects: { '/repo': { hasTrustDialogAccepted: false }, '/other': { hasTrustDialogAccepted: true } } } };
  assert.equal(resolveUserStatusLine('/repo', opts({ ...untrusted, ...project }))?.command, 'user');
  // …or nothing, when the user has none.
  assert.equal(resolveUserStatusLine('/repo', opts({ ...untrusted, '/repo/.claude/settings.local.json': sl('evil') })), undefined);
});

test('trusted folder: the project statusLine is used (matched by real path too)', () => {
  assert.equal(resolveUserStatusLine('/repo', opts({ ...TRUSTED, ...project }))?.command, 'project');
  const viaLink = { ...opts({ ...TRUSTED, '/link/.claude/settings.json': sl('project') }), realpathSync: (p: string) => (p === '/link' ? '/repo' : p) };
  assert.equal(isFolderTrusted('/link', viaLink), true);
});

test('a malformed or missing ~/.claude.json means untrusted', () => {
  for (const state of [undefined, '{ broken', '[]', { projects: [] }, { projects: { '/repo': { hasTrustDialogAccepted: 'yes' } } }, { projects: { '/repo': null } }]) {
    const map: Record<string, unknown> = { ...project };
    if (state !== undefined) map['/home/u/.claude.json'] = state;
    assert.equal(isFolderTrusted('/repo', opts(map)), false, JSON.stringify(state));
    assert.equal(resolveUserStatusLine('/repo', opts(map))?.command, 'user');
  }
});

test('CLAUDE_CONFIG_DIR: trust is read from $CLAUDE_CONFIG_DIR/.claude.json', () => {
  const env = { CLAUDE_CONFIG_DIR: '/cfg' };
  const map = { ...project, '/cfg/settings.json': sl('cfg-user') };
  // ~/.claude.json trusting the folder does not count when the config dir moved.
  assert.equal(resolveUserStatusLine('/repo', opts({ ...map, ...TRUSTED }, env))?.command, 'cfg-user');
  const cfgTrusted = { '/cfg/.claude.json': { projects: { '/repo': { hasTrustDialogAccepted: true } } } };
  assert.equal(resolveUserStatusLine('/repo', opts({ ...map, ...cfgTrusted }, env))?.command, 'project');
});

test('trust is re-checked on every call (never cached)', () => {
  const map: Record<string, unknown> = { ...project, ...TRUSTED };
  const o = opts(map);
  assert.equal(resolveUserStatusLine('/repo', o)?.command, 'project');
  map['/home/u/.claude.json'] = { projects: {} };
  assert.equal(resolveUserStatusLine('/repo', o)?.command, 'user');
});
