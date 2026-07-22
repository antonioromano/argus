import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexNotifyAdapter } from './CodexNotifyAdapter.js';
import type { SignalInjectionContext } from './types.js';

const ctx = (userFlags: string[]): SignalInjectionContext => ({
  sessionId: 'sess-1',
  signalBinPath: '/opt/argus/bin/argus-signal',
  signalDir: '/home/u/.argus/signals',
  userFlags,
});

test('inject: appends -c notify=[argus-signal ... --state idle]', () => {
  const inj = new CodexNotifyAdapter().inject(ctx(['--model', 'o3']));
  assert.deepEqual(inj.flags.slice(0, 2), ['--model', 'o3'], 'user flags preserved first');
  const cIdx = inj.flags.indexOf('-c');
  assert.ok(cIdx >= 0, 'adds -c');
  const notifyVal = inj.flags[cIdx + 1]!;
  assert.ok(notifyVal.startsWith('notify='));
  const program = JSON.parse(notifyVal.slice('notify='.length));
  assert.deepEqual(program, ['/opt/argus/bin/argus-signal', '--session', 'sess-1', '--state', 'idle']);
  assert.equal(inj.files.length, 0);
});

test('inject: skips when the user already set notify (no override)', () => {
  const userFlags = ['-c', 'notify=["/my/own/notifier"]'];
  const inj = new CodexNotifyAdapter().inject(ctx(userFlags));
  assert.deepEqual(inj.flags, userFlags, 'user notify left untouched');
  assert.equal(inj.flags.filter((f) => f.startsWith('notify=')).length, 1, 'no second notify appended');
});

test('coverage is idle-only (does not suppress heuristic waiting/running)', () => {
  assert.deepEqual([...new CodexNotifyAdapter().coverage], ['idle']);
});
