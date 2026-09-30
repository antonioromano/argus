#!/usr/bin/env node
// Registers the dev deep-link scheme (argus-dev://) on the stock Electron.app that
// `npm run dev` launches. macOS only honours URL schemes declared in the bundle's
// Info.plist, so the runtime setAsDefaultProtocolClient('argus-dev') call in
// main.ts is a no-op without this. Idempotent; no-op off macOS or without Electron.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
const plist = join(app, 'Contents', 'Info.plist');
const LSREG = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
if (!existsSync(plist)) process.exit(0);

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const read = () => { try { return run('/usr/bin/plutil', ['-extract', 'CFBundleURLTypes', 'json', '-o', '-', plist]); } catch { return ''; } };

if (!read().includes('"argus-dev"')) {
  const entry = JSON.stringify([{ CFBundleURLName: 'Argus Dev', CFBundleURLSchemes: ['argus-dev'] }]);
  try { run('/usr/bin/plutil', ['-remove', 'CFBundleURLTypes', plist]); } catch { /* absent */ }
  run('/usr/bin/plutil', ['-insert', 'CFBundleURLTypes', '-json', entry, plist]);
  // Editing Info.plist invalidates the bundle signature; re-sign ad hoc so the
  // dev app still launches on Apple Silicon.
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
  run('/usr/bin/codesign', ['--verify', app]);
}
run(LSREG, ['-f', app]);
console.log('[register-dev-scheme] argus-dev:// → ' + app);
