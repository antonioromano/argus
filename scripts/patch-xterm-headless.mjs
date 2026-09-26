// Backports two upstream guards into @xterm/headless 6.0.0 (both fixed in
// 6.1.0-beta, neither in a stable release yet).
//
// Each is a parser path that looks up a buffer row that doesn't exist and
// dereferences it. The throw happens inside xterm's write timer, so it escapes as
// an uncaughtException and takes the whole server down (every session with it) —
// and even if it were caught, xterm's write queue is left stuck on that chunk.
//
// 1. `CSI 1 J` (erase from screen start to cursor) with the cursor on the last
//    row and in the last column clears `isWrapped` on the row *below* the cursor.
//    Repro: `\x1b[999;999H\x1b[1J` → "Cannot set properties of undefined
//    (setting 'isWrapped')".
// 2. `print` fetches the cursor row without checking it exists → "Cannot read
//    properties of undefined (reading 'setCellFromCodepoint')". Upstream now
//    returns early; so do we.
//
// The bundles are minified, so each patch captures the per-bundle variable name
// and must match exactly once. Idempotent, and a no-op on anything but 6.0.x:
// once a stable release ships the fixes, bump the dependency and delete this.

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const PKG_DIR = join('node_modules', '@xterm', 'headless');
const BUNDLES = ['lib-headless/xterm-headless.js', 'lib-headless/xterm-headless.mjs'];

const PATCHES = [
  {
    name: 'ED1 bottom-right row lookup',
    buggy: /this\._activeBuffer\.x\+1>=this\._bufferService\.cols&&\(this\._activeBuffer\.lines\.get\((\w+)\+1\)\.isWrapped=!1\)/g,
    fixed: (v) =>
      `this._activeBuffer.x+1>=this._bufferService.cols&&this._activeBuffer.lines.get(${v}+1)&&(this._activeBuffer.lines.get(${v}+1).isWrapped=!1)`,
  },
  {
    name: 'print cursor row lookup',
    buggy: /(\w+)=this\._activeBuffer\.lines\.get\(this\._activeBuffer\.ybase\+this\._activeBuffer\.y\);this\._dirtyRowTracker\.markDirty\(this\._activeBuffer\.y\)/g,
    fixed: (v) =>
      `${v}=this._activeBuffer.lines.get(this._activeBuffer.ybase+this._activeBuffer.y);if(!${v})return;this._dirtyRowTracker.markDirty(this._activeBuffer.y)`,
  },
];

export async function patchXtermHeadless() {
  let version;
  try {
    version = JSON.parse(await readFile(join(PKG_DIR, 'package.json'), 'utf8')).version;
  } catch {
    return; // not installed in this tree
  }
  if (!/^6\.0\./.test(version)) return;

  for (const rel of BUNDLES) {
    const file = join(PKG_DIR, rel);
    let src;
    try {
      src = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    let changed = false;
    for (const { name, buggy, fixed } of PATCHES) {
      const matches = src.match(buggy)?.length ?? 0;
      if (matches === 0) continue; // already patched
      if (matches > 1) {
        console.warn(`@xterm/headless ${version}: ${name} matched ${matches}× in ${rel}, skipping`);
        continue;
      }
      src = src.replace(buggy, (_, v) => fixed(v));
      changed = true;
      console.log(`@xterm/headless ${version}: patched ${name} in ${rel}`);
    }
    if (changed) await writeFile(file, src);
  }
}
