import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ApiError } from '../services/api.js';
import { describeError } from './describeError.js';
import { registerErrorActionHost } from './errorActions.js';

describe('describeError', () => {
  const cleanups: Array<() => void> = [];
  // jsdom has no clipboard; Electron's renderer does. copy-command needs one.
  beforeEach(() => { vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(() => Promise.resolve()) } }); });
  afterEach(() => { while (cleanups.length) cleanups.pop()!(); vi.unstubAllGlobals(); });

  it('a coded ApiError goes through the table; the raw message never becomes the title', () => {
    const d = describeError(new ApiError(503, 'gh: To get started with GitHub CLI, please run: gh auth login', { code: 'GH_NOT_AUTHENTICATED' }));
    expect(d.code).toBe('GH_NOT_AUTHENTICATED');
    expect(d.title).not.toMatch(/To get started/);
    expect(d.actions).toEqual([{ kind: 'copy-command', command: 'gh auth login' }, { kind: 'retry' }]);
    expect(d.retryable).toBe(true);
  });

  it('gh not installed offers "brew install gh" first', () => {
    const d = describeError(new ApiError(503, 'x', { code: 'GH_NOT_INSTALLED' }));
    expect(d.actions[0]).toEqual({ kind: 'copy-command', command: 'brew install gh' });
  });

  it('server detail is kept for the disclosure, falling back to the raw message', () => {
    expect(describeError(new ApiError(503, 'msg', { code: 'GIT_NOT_INSTALLED', detail: 'spawn git ENOENT' })).detail).toBe('spawn git ENOENT');
    expect(describeError(new ApiError(500, 'git exploded', { code: 'GIT_FAILED' })).detail).toBe('git exploded');
  });

  it('an uncoded 503 falls back to the generic "service unavailable" copy with Retry', () => {
    const d = describeError(new ApiError(503, 'something'));
    expect(d.code).toBeUndefined();
    expect(d.title).toMatch(/unavailable/i);
    expect(d.actions).toEqual([{ kind: 'retry' }]);
    expect(d.detail).toBe('something');
  });

  it('uncoded 404 / 409 / 504 have their own fallbacks', () => {
    expect(describeError(new ApiError(404, 'x')).title).toMatch(/not found/i);
    expect(describeError(new ApiError(409, 'x')).title).toMatch(/conflict|changed/i);
    expect(describeError(new ApiError(504, 'x')).title).toMatch(/too long|timed out/i);
    expect(describeError(new ApiError(504, 'x')).retryable).toBe(true);
  });

  it('a fetch TypeError is SERVER_UNREACHABLE', () => {
    const d = describeError(new TypeError('Failed to fetch'));
    expect(d.code).toBe('SERVER_UNREACHABLE');
    expect(d.title).not.toMatch(/Failed to fetch/);
    expect(d.retryable).toBe(true);
  });

  it('params.installUrl becomes an open-url action; absent, it is left out', () => {
    const withUrl = describeError(new ApiError(503, 'x', { code: 'AGENT_NOT_INSTALLED', params: { tool: 'claude', installUrl: 'https://claude.ai/code' } }));
    expect(withUrl.actions).toContainEqual({ kind: 'open-url', url: 'https://claude.ai/code', label: 'Open install page' });
    expect(withUrl.cause).toMatch(/claude/);
    const without = describeError(new ApiError(503, 'x', { code: 'AGENT_NOT_INSTALLED', params: { tool: 'claude' } }));
    expect(without.actions.some((a) => a.kind === 'open-url')).toBe(false);
  });

  it('an unknown value is generic, with its message as detail', () => {
    const d = describeError(new Error('weird'));
    expect(d.code).toBeUndefined();
    expect(d.title).toBe('Something went wrong');
    expect(d.detail).toBe('weird');
    expect(describeError('string failure').detail).toBe('string failure');
    expect(describeError(undefined).detail).toBeUndefined();
  });

  it('a fallback title replaces the generic headline for uncoded errors only', () => {
    expect(describeError(new Error('x'), { fallbackTitle: 'Couldn’t load activity' }).title).toBe('Couldn’t load activity');
    expect(describeError(new ApiError(503, 'x', { code: 'GH_NOT_INSTALLED' }), { fallbackTitle: 'Nope' }).title).not.toBe('Nope');
  });

  it('missing ripgrep reads as a broken build: Reinstall Argus', () => {
    const d = describeError(new ApiError(503, 'ripgrep is not available', { code: 'RIPGREP_UNAVAILABLE' }));
    expect(d.cause).toMatch(/Reinstall Argus/);
    expect(d.retryable).toBe(false);
  });

  it('copy-command is left out where there is no clipboard', () => {
    vi.stubGlobal('navigator', {});
    expect(describeError(new ApiError(503, 'x', { code: 'GH_NOT_INSTALLED' })).actions).toEqual([{ kind: 'retry' }]);
  });

  it('an action whose host has no handler is filtered out of actions', () => {
    const err = new ApiError(503, 'x', { code: 'AGENT_NOT_INSTALLED', params: { tool: 'claude' } });
    expect(describeError(err).actions).not.toContainEqual({ kind: 'open-settings', pane: 'agents' });
    cleanups.push(registerErrorActionHost({ 'open-settings': vi.fn() }));
    expect(describeError(err).actions).toContainEqual({ kind: 'open-settings', pane: 'agents' });
  });
});
