import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_SETTINGS_URLS, systemSettingsUrl } from './systemSettings.js';

test('known panes map to fixed x-apple.systempreferences URLs', () => {
  assert.equal(systemSettingsUrl('notifications'), SYSTEM_SETTINGS_URLS.notifications);
  for (const url of Object.values(SYSTEM_SETTINGS_URLS)) {
    assert.match(url, /^x-apple\.systempreferences:com\.apple\.[A-Za-z.-]+$/);
  }
});

test('anything else the renderer sends opens nothing', () => {
  for (const bad of ['privacy', 'x-apple.systempreferences:evil', 'https://example.com', 'toString', '__proto__', 42, null, undefined, {}]) {
    assert.equal(systemSettingsUrl(bad), null, String(bad));
  }
});
