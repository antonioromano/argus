import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StateDetector } from './StateDetector.js';
import { FakeClock } from './StateDetector.testClock.js';
import { permissionModeFromFooter } from './claudeScreen.js';

test('every settle hands the bottom rows to onSettled (Chat view mode tracking)', async () => {
  const clock = new FakeClock();
  const det = new StateDetector(() => {}, 'claude', 120, 30, undefined, clock);
  const seen: string[][] = [];
  det.setOnSettled((rows) => seen.push(rows));
  det.feed('\r\n'.repeat(20) + '❯ \r\n  ⏸ plan mode on (shift+tab to cycle)');
  await clock.advance(900);
  assert.ok(seen.length >= 1);
  assert.equal(permissionModeFromFooter(seen.at(-1)!), 'plan');
  det.destroy();
});
