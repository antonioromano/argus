// This test reads the filesystem directly (readFileSync/globSync) — the
// default jsdom environment (client/vitest.config.ts) pre-bundles node:fs
// through a browser-externalized shim that throws ("No such built-in module:
// node:") the instant any of its functions are called, so this file opts
// into the real Node environment instead. Confirmed via probe: globSync AND
// readFileSync both fail under plain jsdom, and both work with this pragma.
// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Every component that paints above --z-pop sits above the web content that a
// native overlay also covers — so each must suppress. Measured in Gate A: a
// child NSWindow always orders above its parent's content.
const Z_TIERS = ['--z-pop', '--z-sheet', '--z-tooltip', '--z-overlay', '--z-toast'];

// client/src, resolved relative to this file (client/src/hooks/) rather than
// cwd — Vitest can be invoked with --root or from a different working
// directory, and a cwd-relative glob would silently scan the wrong tree (or
// nothing at all) in that case.
const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('overlay suppression contract', () => {
  it('every component rendering above --z-pop calls useOverlaySuppression', () => {
    const files = globSync('**/*.tsx', { cwd: srcDir });
    const offenders: string[] = [];
    for (const f of files) {
      if (f.includes('.test.')) continue;
      // app/mobile is served to a phone browser over ngrok — a completely
      // separate renderer/origin with no `window.electronNativeTerminal`
      // bridge and no way to ever reach the native-overlay registry. A
      // native terminal overlay can only exist in the Electron desktop
      // renderer, so there is nothing for these components to cover.
      if (f.startsWith('app/mobile/')) continue;
      const src = readFileSync(join(srcDir, f), 'utf-8');
      const paints = Z_TIERS.some((t) => src.includes(t));
      if (paints && !src.includes('useOverlaySuppression')) offenders.push(f);
    }
    expect(offenders, `these paint above --z-pop but never suppress overlays:\n${offenders.join('\n')}`).toEqual([]);
  });
});
