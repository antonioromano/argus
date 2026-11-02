import { describe, it, expect } from 'vitest';
import { shouldAskNotifications, type AskInput } from './notificationAsk.js';

const yes: AskInput = {
  prevStatus: 'running', status: 'waiting', owned: true, notificationsEnabled: false,
  notifAskedAt: 0, isMainWindow: true, bridgeAvailable: true, blocked: false,
};

describe('shouldAskNotifications', () => {
  it('asks on an owned running → waiting transition', () => {
    expect(shouldAskNotifications(yes)).toBe(true);
    expect(shouldAskNotifications({ ...yes, prevStatus: 'idle' })).toBe(true);
  });

  it.each<[string, Partial<AskInput>]>([
    ['first sighting (undefined → waiting)', { prevStatus: undefined }],
    ['waiting → waiting', { prevStatus: 'waiting' }],
    ['not a waiting status', { status: 'idle' }],
    ['not owned', { owned: false }],
    ['already enabled', { notificationsEnabled: true }],
    ['already asked', { notifAskedAt: 1 }],
    ['secondary window', { isMainWindow: false }],
    ['no Electron bridge', { bridgeAvailable: false }],
    ['a sheet is open', { blocked: true }],
  ])('does not ask: %s', (_name, over) => {
    expect(shouldAskNotifications({ ...yes, ...over })).toBe(false);
  });
});
