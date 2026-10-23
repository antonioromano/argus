// Guards the layered macOS app icon wiring (scripts/build-icon.mjs): the Icon
// Composer document keeps a readable glyph in every appearance, the committed
// Assets.car is in sync with it, and the bundle config points the system at it
// while keeping the .icns fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Compiled to electron/dist/, so the repo root is two levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const iconDoc = join(repoRoot, 'electron/assets/Argus.icon');

type Fill = { solid?: string };
type Spec = { appearance?: string; value: Fill };
type Layer = { 'image-name': string; 'fill-specializations'?: Spec[] };
type IconJson = { 'fill-specializations'?: Spec[]; groups: { layers: Layer[] }[] };

const icon: IconJson = JSON.parse(readFileSync(join(iconDoc, 'icon.json'), 'utf8'));
const layers = icon.groups.flatMap((g) => g.layers);
const fillFor = (specs: Spec[] | undefined, appearance?: string) =>
  specs?.find((s) => s.appearance === appearance)?.value.solid;

test('every layer image exists as a separate asset', () => {
  assert.ok(layers.length >= 2, 'glyph should be split into layers');
  for (const l of layers) assert.ok(existsSync(join(iconDoc, 'Assets', l['image-name'])), l['image-name']);
});

test('Dark swaps to an amber glyph on a dark background (no black-on-black)', () => {
  const bgLight = fillFor(icon['fill-specializations']);
  const bgDark = fillFor(icon['fill-specializations'], 'dark');
  assert.ok(bgLight && bgDark && bgLight !== bgDark, 'background needs a dark specialization');
  for (const l of layers) {
    const specs = l['fill-specializations'];
    assert.equal(fillFor(specs), bgDark, `${l['image-name']}: default glyph is dark on amber`);
    assert.equal(fillFor(specs, 'dark'), bgLight, `${l['image-name']}: dark glyph is amber`);
    assert.ok(fillFor(specs, 'tinted'), `${l['image-name']}: tinted/clear glyph needs a light fill`);
  }
});

test('committed Assets.car is compiled from the current Argus.icon', () => {
  // Throws (non-zero exit) when the sources changed without `npm run build:icon`.
  execFileSync(process.execPath, [join(repoRoot, 'scripts/build-icon.mjs'), '--check'], { stdio: 'pipe' });
});

test('bundle ships Assets.car via CFBundleIconName and keeps the .icns fallback', () => {
  const config = createRequire(import.meta.url)(join(repoRoot, 'electron-builder.config.cjs'));
  assert.equal(config.mac.extendInfo.CFBundleIconName, basename(iconDoc, '.icon'), 'must match the .icon basename');
  assert.equal(config.mac.icon, 'electron/assets/Argus.icns', '.icns fallback rendered from the same .icon');
  assert.ok(
    config.extraResources.some(
      (r: { from: string; to: string }) => r.from === 'electron/assets/Assets.car' && r.to === 'Assets.car',
    ),
    'Assets.car must land in Contents/Resources',
  );
});
