import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  availableActions,
  canRunErrorAction,
  registerErrorActionHost,
  runErrorAction,
  errorActionLabel,
  SETTINGS_PANE_LABEL,
  type ErrorAction,
} from './errorActions.js';
import { PANES } from '../app/overlays/settings/registry.js';

vi.mock('../utils/openExternal.js', () => ({ openExternal: vi.fn() }));
import { openExternal } from '../utils/openExternal.js';

describe('error action host', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
    vi.unstubAllGlobals();
    vi.mocked(openExternal).mockClear();
  });

  it('retry runs only when the surface passes onRetry', () => {
    const onRetry = vi.fn();
    expect(canRunErrorAction({ kind: 'retry' })).toBe(false);
    expect(canRunErrorAction({ kind: 'retry' }, { onRetry })).toBe(true);
    void runErrorAction({ kind: 'retry' }, { onRetry });
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('copy-command writes the command to the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await runErrorAction({ kind: 'copy-command', command: 'brew install gh' })).toBe(true);
    expect(writeText).toHaveBeenCalledWith('brew install gh');
  });

  it('open-url goes through openExternal', async () => {
    await runErrorAction({ kind: 'open-url', url: 'https://cli.github.com' });
    expect(openExternal).toHaveBeenCalledWith('https://cli.github.com');
  });

  it('host-owned actions are unavailable until a host registers them', async () => {
    const action: ErrorAction = { kind: 'open-settings', pane: 'agents' };
    expect(canRunErrorAction(action)).toBe(false);
    expect(await runErrorAction(action)).toBe(false);
    const openSettings = vi.fn();
    cleanups.push(registerErrorActionHost({ 'open-settings': openSettings }));
    expect(canRunErrorAction(action)).toBe(true);
    await runErrorAction(action);
    expect(openSettings).toHaveBeenCalledWith(action);
  });

  it('unregistering removes the handler', () => {
    const off = registerErrorActionHost({ 'restart-session': vi.fn() });
    expect(canRunErrorAction({ kind: 'restart-session', sessionId: 's1' })).toBe(true);
    off();
    expect(canRunErrorAction({ kind: 'restart-session', sessionId: 's1' })).toBe(false);
  });

  it('report-issue stays hidden: nothing registers it yet (plan 002)', () => {
    expect(canRunErrorAction({ kind: 'report-issue' })).toBe(false);
  });

  it('availableActions filters out actions with no handler, keeping order', () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } });
    cleanups.push(registerErrorActionHost({ 'open-settings': vi.fn() }));
    const actions: ErrorAction[] = [
      { kind: 'copy-command', command: 'gh auth login' },
      { kind: 'report-issue' },
      { kind: 'open-settings', pane: 'shell-header' },
      { kind: 'retry' },
    ];
    expect(availableActions(actions).map((a) => a.kind)).toEqual(['copy-command', 'open-settings']);
    expect(availableActions(actions, { onRetry: () => {} }).map((a) => a.kind)).toEqual(['copy-command', 'open-settings', 'retry']);
  });

  it('labels name what the button does', () => {
    expect(errorActionLabel({ kind: 'retry' })).toBe('Retry');
    expect(errorActionLabel({ kind: 'copy-command', command: 'brew install gh' })).toBe('Copy “brew install gh”');
    expect(errorActionLabel({ kind: 'open-settings', pane: 'agents' })).toBe('Open Settings → Agents');
    expect(errorActionLabel({ kind: 'open-url', url: 'https://x', label: 'Open install page' })).toBe('Open install page');
    expect(errorActionLabel({ kind: 'restart-session', sessionId: 's' })).toBe('Restart session');
  });

  it('pane labels match the settings registry', () => {
    expect(Object.fromEntries(PANES.map((p) => [p.id, p.label]))).toEqual(SETTINGS_PANE_LABEL);
  });
});
