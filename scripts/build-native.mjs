#!/usr/bin/env node
// Builds the native terminal engine (Swift dylib + Node addon) for BOTH macOS
// architectures and stages the results for electron-builder to bundle.
//
// Why both arches from one host: electron-builder.config.cjs ships
// `target: [{ target: 'dmg', arch: ['arm64', 'x64'] }]`, but electron-builder
// does not invoke this build per arch — it packages whatever already exists on
// disk once, into two dmgs. `swift build -c release` and `node-gyp rebuild`
// each produce a HOST-ARCH-ONLY binary, so without this script both dmgs would
// ship the same (only-correct-on-one-arch) binaries.
//
// A single universal build (`swift build --arch arm64 --arch x86_64`) was
// tried first and rejected: SwiftPM switches to its XCBuild backend for
// multi-arch builds, and that backend cannot resolve SwiftTerm's
// SwiftTermBuildInfoPlugin build-tool plugin ("Unable to resolve build file
// ... missing target ... SwiftTermBuildInfoPlugin"). Building each arch
// separately (the same approach daemon/Makefile already uses for the Go
// argusd daemon) avoids that entirely — Apple's macOS SDK supports targeting
// either arch from either host via `swift build --arch <arch>` and
// `node-gyp rebuild --arch=<arch>`, no Rosetta or second machine required.
//
// Output layout (consumed by electron-builder.config.cjs's `native-terminal`
// extraResources entry, and mirrored by binding.gyp's packaged @loader_path
// rpath so the addon finds its dylib without any repo-relative path):
//   electron/resources/native-terminal/<arch>/argus_native_terminal.node
//   electron/resources/native-terminal/<arch>/libArgusTerminal.dylib
//
// `<arch>` is Node's arch naming (arm64 / x64) — see resolveDaemonBin.ts and
// PtyManager's tmux-<arch> resolution for the same convention.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const swiftPackagePath = path.join(repoRoot, 'native/ArgusTerminal');
const addonDir = path.join(repoRoot, 'native/addon');
const addonOutput = path.join(addonDir, 'build/Release/argus_native_terminal.node');
const outRoot = path.join(repoRoot, 'electron/resources/native-terminal');

// Node arch name -> Swift's `--arch` value (differs only for x64/x86_64).
const ALL_ARCHES = [
  { nodeArch: 'arm64', swiftArch: 'arm64' },
  { nodeArch: 'x64', swiftArch: 'x86_64' },
];

// `--arch=<a>` (repeatable) limits the build. Packaging needs both arches, but
// `npm run dev` only ever dlopens the host's, and a cross-arch build it cannot
// load costs ~90s per launch. Unknown names are a hard error, not a silent
// no-op, so a typo can never quietly stage zero artifacts.
const requested = process.argv
  .slice(2)
  .filter((a) => a.startsWith('--arch='))
  .map((a) => a.slice('--arch='.length));

for (const a of requested) {
  if (!ALL_ARCHES.some((x) => x.nodeArch === a)) {
    console.error(
      `[build-native] unknown --arch=${a} (expected ${ALL_ARCHES.map((x) => x.nodeArch).join(' or ')})`,
    );
    process.exit(1);
  }
}

const ARCHES = requested.length
  ? ALL_ARCHES.filter((x) => requested.includes(x.nodeArch))
  : ALL_ARCHES;

const electronVersion = execFileSync(
  'node',
  ['-p', "require('electron/package.json').version"],
  { cwd: repoRoot, encoding: 'utf8' },
).trim();

for (const { nodeArch, swiftArch } of ARCHES) {
  console.log(`\n[build-native] === ${nodeArch} ===`);

  console.log(`[build-native] swift build -c release --arch ${swiftArch}`);
  execFileSync(
    'swift',
    ['build', '-c', 'release', '--arch', swiftArch, '--package-path', swiftPackagePath],
    { stdio: 'inherit' },
  );

  ensureSwiftHeader(swiftArch);

  console.log(`[build-native] node-gyp rebuild --arch=${nodeArch}`);
  execFileSync(
    process.platform === 'win32' ? 'node-gyp.cmd' : 'node-gyp',
    [
      'rebuild',
      `--directory=${addonDir}`,
      `--arch=${nodeArch}`,
      `--target=${electronVersion}`,
      '--dist-url=https://electronjs.org/headers',
    ],
    { stdio: 'inherit', cwd: repoRoot },
  );

  if (!existsSync(addonOutput)) {
    throw new Error(`[build-native] expected node-gyp output missing: ${addonOutput}`);
  }

  const swiftDylib = path.join(
    swiftPackagePath,
    '.build',
    `${swiftArch}-apple-macosx`,
    'release',
    'libArgusTerminal.dylib',
  );
  if (!existsSync(swiftDylib)) {
    throw new Error(`[build-native] expected swift dylib missing: ${swiftDylib}`);
  }

  const archOut = path.join(outRoot, nodeArch);
  rmSync(archOut, { recursive: true, force: true });
  mkdirSync(archOut, { recursive: true });
  // node-gyp rebuilds argus_native_terminal.node in place on every iteration
  // (there's no per-arch output dir like SwiftPM's), so copy it out to its
  // arch-named home before the next arch's build overwrites it.
  copyFileSync(addonOutput, path.join(archOut, 'argus_native_terminal.node'));
  copyFileSync(swiftDylib, path.join(archOut, 'libArgusTerminal.dylib'));
  console.log(`[build-native] staged ${nodeArch} artifacts -> ${archOut}`);
}

console.log('\n[build-native] done.');

/**
 * binding.gyp compiles addon.mm against the ObjC header SwiftPM generates for
 * the Swift target, and looks for it in `<target>.build/include/` — where
 * Xcode 26's SwiftPM writes it. Older toolchains (the macos-15 CI runner's
 * default Xcode 16) put it elsewhere under the same release directory, so the
 * addon failed with "'ArgusTerminal-Swift.h' file not found" even though the
 * Swift build succeeded. Find it wherever this SwiftPM put it and copy it to
 * the path binding.gyp uses; fail loudly, with what was found, if it is absent.
 */
function ensureSwiftHeader(swiftArch) {
  const releaseDir = path.join(swiftPackagePath, '.build', `${swiftArch}-apple-macosx`, 'release');
  const expectedDir = path.join(releaseDir, 'ArgusTerminal.build', 'include');
  const expected = path.join(expectedDir, 'ArgusTerminal-Swift.h');
  if (existsSync(expected)) return;

  const found = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name === 'ArgusTerminal-Swift.h') found.push(full);
    }
  };
  walk(releaseDir, 0);

  if (found.length === 0) {
    const targetDir = path.join(releaseDir, 'ArgusTerminal.build');
    const listing = existsSync(targetDir) ? readdirSync(targetDir).join(', ') : '(missing)';
    throw new Error(
      `[build-native] ArgusTerminal-Swift.h was not generated under ${releaseDir}. ` +
      `ArgusTerminal.build contains: ${listing}`,
    );
  }
  console.log(`[build-native] Swift header found at ${found[0]}; copying to ${expected}`);
  mkdirSync(expectedDir, { recursive: true });
  copyFileSync(found[0], expected);
}
