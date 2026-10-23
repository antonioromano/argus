#!/usr/bin/env node
// Compile the layered macOS app icon (electron/assets/Argus.icon, an Icon
// Composer document) into electron/assets/Assets.car.
//
// macOS 26 only renders the Dark / Tinted / Clear appearances from an asset
// catalog: a flat .icns has one bitmap, so in Dark mode our black-on-amber
// spartan just goes black-on-black. The bundle ships both — Assets.car looked up
// via CFBundleIconName (electron-builder.config.cjs mac.extendInfo) and the
// .icns electron-builder generates from icon.png as the CFBundleIconFile
// fallback for anything that can't read the catalog.
//
// actool needs Xcode 26+, which CI's macos-15 runner doesn't guarantee, so the
// compiled Assets.car is COMMITTED. Assets.car.sha256 records the hash of the
// .icon sources it was built from; electron/src/appIcon.test.ts fails when the
// sources change without a recompile.
//
// Run: `npm run build:icon` (after editing Argus.icon) · `--check` verifies only.

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.join(repoRoot, 'electron/assets');
const iconDoc = path.join(assetsDir, 'Argus.icon');
const carPath = path.join(assetsDir, 'Assets.car');
const stampPath = path.join(assetsDir, 'Assets.car.sha256');
// Must equal the .icon basename (actool names the icon after it) and
// mac.extendInfo.CFBundleIconName in electron-builder.config.cjs.
const ICON_NAME = 'Argus';

function listFiles(dir, rel = '') {
  return readdirSync(path.join(dir, rel))
    .filter((name) => !name.startsWith('.'))
    .sort()
    .flatMap((name) => {
      const r = path.posix.join(rel, name);
      return statSync(path.join(dir, r)).isDirectory() ? listFiles(dir, r) : [r];
    });
}

/** sha256 over every file of the .icon document (path + contents, sorted). */
export function hashIconSources(doc = iconDoc) {
  const h = createHash('sha256');
  for (const rel of listFiles(doc)) {
    h.update(`${rel}\0`);
    h.update(readFileSync(path.join(doc, rel)));
    h.update('\0');
  }
  return h.digest('hex');
}

function check() {
  const want = hashIconSources();
  let have = '';
  try {
    have = readFileSync(stampPath, 'utf8').trim();
  } catch {}
  statSync(carPath);
  if (have !== want) {
    console.error('✖ Assets.car is stale: Argus.icon changed since it was compiled. Run `npm run build:icon`.');
    process.exit(1);
  }
  console.log('✓ Assets.car matches Argus.icon');
}

function build() {
  const out = mkdtempSync(path.join(os.tmpdir(), 'argus-icon-'));
  try {
    execFileSync(
      'xcrun',
      [
        'actool', iconDoc,
        '--compile', out,
        '--output-format', 'human-readable-text',
        '--errors', '--warnings', '--notices',
        '--output-partial-info-plist', path.join(out, 'partial.plist'),
        '--app-icon', ICON_NAME,
        '--include-all-app-icons',
        '--enable-on-demand-resources', 'NO',
        '--development-region', 'en',
        '--target-device', 'mac',
        '--platform', 'macosx',
        // Matches Electron's own floor; actool still bakes the legacy raster
        // renditions older macOS shows instead of the Liquid Glass layers.
        '--minimum-deployment-target', '11.0',
      ],
      { stdio: 'inherit' },
    );
    copyFileSync(path.join(out, 'Assets.car'), carPath);
    writeFileSync(stampPath, `${hashIconSources()}\n`);
    console.log(`✓ wrote ${path.relative(repoRoot, carPath)}`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) check();
  else build();
}
