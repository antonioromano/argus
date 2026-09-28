import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideQuitConfirmation } from './quitPolicy.js';

const base = { explicitStopAll: false, exitSessionsOnQuit: false, confirmExitOnQuit: true, confirmQuitDirectSessions: true };
const direct = (name: string, status = 'running') => ({ name, status, runMode: 'direct' as const });
const persistent = (name: string) => ({ name, status: 'running', runMode: 'persistent' as const });

test('a running direct session makes a plain quit ask, listing only direct sessions', () => {
  const r = decideQuitConfirmation({ ...base, sessions: [direct('a'), persistent('b')] });
  assert.equal(r.kind, 'direct');
  assert.deepEqual(r.kind === 'direct' && r.sessions.map((s) => s.name), ['a']);
});

test('no running direct session → no dialog', () => {
  assert.equal(decideQuitConfirmation({ ...base, sessions: [persistent('b')] }).kind, 'none');
  assert.equal(decideQuitConfirmation({ ...base, sessions: [direct('a', 'exited')] }).kind, 'none');
});

test('"Don\'t ask again" turns it off', () => {
  assert.equal(decideQuitConfirmation({ ...base, confirmQuitDirectSessions: false, sessions: [direct('a')] }).kind, 'none');
});

test('the stop-all confirmation keeps precedence and covers everything', () => {
  const r = decideQuitConfirmation({ ...base, exitSessionsOnQuit: true, sessions: [direct('a'), persistent('b')] });
  assert.equal(r.kind, 'stop-all');
});

test('Quit & Stop All (explicit) never shows the direct dialog', () => {
  assert.equal(decideQuitConfirmation({ ...base, explicitStopAll: true, sessions: [direct('a')] }).kind, 'none');
});

test('stop-all with its own confirmation turned off shows nothing — direct sessions are stopped either way', () => {
  assert.equal(decideQuitConfirmation({ ...base, exitSessionsOnQuit: true, confirmExitOnQuit: false, sessions: [direct('a')] }).kind, 'none');
});
