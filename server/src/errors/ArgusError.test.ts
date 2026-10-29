import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { ArgusError, classifyError, ghUnavailableCode, sendError } from './ArgusError.js';
import { errorHandler } from '../middleware/errorHandler.js';

const errno = (fields: Record<string, unknown>, message = 'boom') => Object.assign(new Error(message), fields);

test('spawn ENOENT for git → GIT_NOT_INSTALLED 503', () => {
  const e = classifyError(errno({ code: 'ENOENT', syscall: 'spawn git', path: 'git' }, 'spawn git ENOENT'));
  assert.equal(e.code, 'GIT_NOT_INSTALLED');
  assert.equal(e.status, 503);
  assert.equal(e.params?.tool, 'git');
  assert.equal(e.detail, 'spawn git ENOENT');
  assert.doesNotMatch(e.message, /ENOENT/);
});

test('the tool is read from the absolute spawn path', () => {
  const e = classifyError(errno({ code: 'ENOENT', syscall: 'spawn /opt/homebrew/bin/gh', path: '/opt/homebrew/bin/gh' }));
  assert.equal(e.code, 'GH_NOT_INSTALLED');
  assert.equal(e.status, 503);
});

test('the hint names the tool when the path does not', () => {
  assert.equal(classifyError(errno({ code: 'ENOENT', syscall: 'spawn', path: '' }), { tool: 'ngrok' }).code, 'NGROK_NOT_INSTALLED');
  assert.equal(classifyError(errno({ code: 'ENOENT', syscall: 'spawn rg', path: 'rg' })).code, 'RIPGREP_UNAVAILABLE');
});

test('a spawn ENOENT of an agent CLI → AGENT_NOT_INSTALLED with its install page', () => {
  const e = classifyError(errno({ code: 'ENOENT', syscall: 'spawn claude', path: 'claude' }), {
    agent: 'claude', installUrl: 'https://claude.ai/code',
  });
  assert.equal(e.code, 'AGENT_NOT_INSTALLED');
  assert.deepEqual(e.params, { tool: 'claude', agent: 'claude', installUrl: 'https://claude.ai/code' });
});

test('gh exit 4 or a "gh auth login" stderr → GH_NOT_AUTHENTICATED 503', () => {
  const byExit = classifyError(errno({ code: 4 }), { tool: 'gh' });
  assert.equal(byExit.code, 'GH_NOT_AUTHENTICATED');
  assert.equal(byExit.status, 503);
  const byStderr = classifyError(errno({ code: 1, stderr: 'To get started with GitHub CLI, please run:  gh auth login' }));
  assert.equal(byStderr.code, 'GH_NOT_AUTHENTICATED');
  assert.match(byStderr.detail ?? '', /gh auth login/);
});

test('exit 4 from a tool that is not gh is not an auth failure', () => {
  assert.notEqual(classifyError(errno({ code: 4 }), { tool: 'git' }).code, 'GH_NOT_AUTHENTICATED');
});

test('ghUnavailableCode tells missing apart from logged out', () => {
  assert.equal(ghUnavailableCode(errno({ code: 'ENOENT' })), 'GH_NOT_INSTALLED');
  assert.equal(ghUnavailableCode(errno({ code: 'EACCES' })), 'GH_NOT_INSTALLED');
  assert.equal(ghUnavailableCode(errno({ code: 4 })), 'GH_NOT_AUTHENTICATED');
  assert.equal(ghUnavailableCode(errno({ code: 1, stderr: 'error: not logged in' })), 'GH_NOT_AUTHENTICATED');
  assert.equal(ghUnavailableCode(errno({ code: 1, stderr: 'no pull requests found' })), null);
});

test('execFile kill-on-timeout → TIMEOUT 504, tool-specific when known', () => {
  const plain = classifyError(errno({ killed: true, signal: 'SIGTERM' }));
  assert.equal(plain.code, 'TIMEOUT');
  assert.equal(plain.status, 504);
  assert.equal(classifyError(errno({ killed: true, signal: 'SIGTERM' }), { tool: 'gh' }).code, 'GH_TIMEOUT');
  assert.equal(classifyError(errno({ killed: true, signal: 'SIGTERM' }), { tool: 'ngrok' }).code, 'NGROK_TIMEOUT');
});

test('stderr "not a git repository" → NOT_A_GIT_REPO 409', () => {
  const e = classifyError(errno({ code: 128, stderr: 'fatal: not a git repository (or any of the parent directories): .git' }), { tool: 'git' });
  assert.equal(e.code, 'NOT_A_GIT_REPO');
  assert.equal(e.status, 409);
});

test('EACCES / EPERM on a path → PERMISSION_DENIED 403', () => {
  for (const code of ['EACCES', 'EPERM']) {
    const e = classifyError(errno({ code, syscall: 'open', path: '/x/y' }));
    assert.equal(e.code, 'PERMISSION_DENIED');
    assert.equal(e.status, 403);
  }
});

test('ENOENT on a path (not a spawn) → FOLDER_NOT_FOUND 404, never *_NOT_INSTALLED', () => {
  const e = classifyError(errno({ code: 'ENOENT', syscall: 'open', path: '/repo/git' }), { tool: 'git' });
  assert.equal(e.code, 'FOLDER_NOT_FOUND');
  assert.equal(e.status, 404);
});

test('an unknown error → INTERNAL 500 with the message kept as detail', () => {
  const e = classifyError(new Error('x'));
  assert.equal(e.code, 'INTERNAL');
  assert.equal(e.status, 500);
  assert.equal(e.detail, 'x');
  assert.equal(e.message, 'x', 'the message stays for clients that print it');
});

test('an unknown git failure → GIT_FAILED with stderr as detail', () => {
  const e = classifyError(errno({ code: 1, stderr: 'error: pathspec did not match\n' }, 'Command failed: git add'), { tool: 'git' });
  assert.equal(e.code, 'GIT_FAILED');
  assert.equal(e.status, 500);
  assert.equal(e.detail, 'error: pathspec did not match');
});

test('an unknown failure keeps the route status; 4xx stays code-less (validation)', () => {
  const e = classifyError(new Error('Invalid worktree branch name'), { status: 400 });
  assert.equal(e.status, 400);
  assert.equal(e.code, undefined);
  assert.equal(e.message, 'Invalid worktree branch name');
});

test('an ArgusError passes through unchanged', () => {
  const original = new ArgusError('DAEMON_UNAVAILABLE', 503, 'argusd did not come up in time');
  assert.equal(classifyError(original, { status: 400 }), original);
});

test('non-Error values classify without throwing', () => {
  assert.equal(classifyError('nope').code, 'INTERNAL');
  assert.equal(classifyError(null).code, 'INTERNAL');
  // GitService.execGitWithStderr rejects with a plain object.
  assert.equal(classifyError({ message: 'x', stderr: 'fatal: not a git repository' }).code, 'NOT_A_GIT_REPO');
});

async function serve(mount: (app: express.Express) => void) {
  const app = express();
  mount(app);
  app.use(errorHandler);
  const server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const { port } = server.address() as AddressInfo;
  return {
    get: (p: string) => fetch(`http://127.0.0.1:${port}${p}`),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

test('sendError answers with status, code, detail, params and merges route fields', async () => {
  const srv = await serve((app) => {
    app.get('/x', (_req, res) => sendError(res, errno({ code: 'ENOENT', syscall: 'spawn git', path: 'git' }, 'spawn git ENOENT'), { tool: 'git' }, { success: false }));
  });
  try {
    const res = await srv.get('/x');
    assert.equal(res.status, 503);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.code, 'GIT_NOT_INSTALLED');
    assert.equal(body.success, false);
    assert.equal(typeof body.error, 'string');
    assert.equal(body.detail, 'spawn git ENOENT');
    assert.deepEqual(body.params, { tool: 'git' });
  } finally {
    await srv.close();
  }
});

test('errorHandler answers an ArgusError with its status and code', async () => {
  const srv = await serve((app) => {
    app.get('/x', (_req, _res, next) => next(new ArgusError('GH_TIMEOUT', 504, 'gh took too long')));
  });
  try {
    const res = await srv.get('/x');
    assert.equal(res.status, 504);
    assert.deepEqual(await res.json(), { error: 'gh took too long', code: 'GH_TIMEOUT' });
  } finally {
    await srv.close();
  }
});

test('errorHandler: the generic 500 carries code INTERNAL and no raw detail', async () => {
  const srv = await serve((app) => {
    app.get('/x', (_req, _res, next) => next(new Error('secret internals')));
  });
  const origError = console.error;
  console.error = () => {};
  try {
    const res = await srv.get('/x');
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Internal server error', code: 'INTERNAL' });
  } finally {
    console.error = origError;
    await srv.close();
  }
});

test('a spawn ENOENT whose cwd is missing (GitService tags it) is FOLDER_NOT_FOUND, not GIT_NOT_INSTALLED', () => {
  const e = classifyError(errno({ code: 'ENOENT', syscall: 'spawn /usr/bin/git', path: '/usr/bin/git', tool: 'git', cwdMissing: true }));
  assert.equal(e.code, 'FOLDER_NOT_FOUND');
  assert.equal(e.status, 404);
});

test('the tool tagged on the raw error stands in for the hint', () => {
  const e = classifyError(errno({ code: 1, stderr: 'error: bad', tool: 'git' }));
  assert.equal(e.code, 'GIT_FAILED');
});
