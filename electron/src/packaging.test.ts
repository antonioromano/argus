// Guards electron-builder settings the packaged app depends on at runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Compiled to electron/dist/, so the repo root is two levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = createRequire(import.meta.url)(join(repoRoot, 'electron-builder.config.cjs'));

test('renderer bundle is unpacked from the asar', () => {
  // The server serves it from app.asar.unpacked (server/src/utils/clientDist.ts).
  // Served from inside the asar, Electron's $TMPDIR copies of the files get
  // purged by macOS after ~3 days, and every new window or reload shows
  // {"error":"Bad request"} until the app restarts.
  assert.ok(config.asarUnpack.includes('client/dist/**'), 'asarUnpack must include client/dist/**');
});
