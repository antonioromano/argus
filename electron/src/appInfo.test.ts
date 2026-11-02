import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appInfo, readBuildStamp } from './appInfo.js';

test('readBuildStamp reads a valid stamp and rejects anything else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildinfo-'));
  try {
    const file = join(dir, 'build-info.json');
    assert.equal(readBuildStamp(file), null, 'missing file');
    writeFileSync(file, JSON.stringify({ sha: 'abc1234', builtAt: '2026-10-29T10:00:00Z', dirty: true }));
    assert.deepEqual(readBuildStamp(file), { sha: 'abc1234', builtAt: '2026-10-29T10:00:00Z', dirty: true });
    writeFileSync(file, JSON.stringify({ sha: '/Users/me/evil' }));
    assert.equal(readBuildStamp(file), null, 'not a sha');
    writeFileSync(file, '{nope');
    assert.equal(readBuildStamp(file), null, 'malformed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('appInfo carries runtimes and only allowlisted links', () => {
  const info = appInfo({ appVersion: '1.0.0', packaged: false, macos: '26.1', arch: 'arm64', versions: { electron: '39.0.0' }, build: null });
  assert.equal(info.electron, '39.0.0');
  assert.equal(info.chrome, 'unknown');
  assert.equal(info.build, null);
  for (const url of Object.values(info.links)) assert.match(url, /^https:\/\//);
});
