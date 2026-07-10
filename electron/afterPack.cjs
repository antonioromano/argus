const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

// electron-builder skips the bundle codesign pass when mac.identity is null,
// leaving only the linker's bare ad-hoc signature on the inner Electron binary
// (Sealed Resources=none) — an invalid signature that macOS reports as
// "damaged" on Apple Silicon. Re-sign the whole .app ad-hoc here (afterPack
// runs before DMG packaging) so resources are sealed and the bundle loads.
//
// The vendored terminal-notifier.app (Contents/Resources/terminal-notifier/)
// must keep its committed signature: macOS notification permission binds to
// the bundle's code identity, so a per-build re-sign would silently break
// delivery for users who already granted it. We move it aside during the
// --deep pass, restore it, then re-sign the outer bundle WITHOUT --deep to
// recompute the resource seal (a non-deep sign leaves nested code untouched).
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  // Harden Electron fuses on the packaged binary BEFORE any code-signing pass.
  // flipFuses rewrites the Mach-O fuse wire (which lives in the Electron
  // Framework binary — passing the .app path resolves there automatically),
  // invalidating any existing signature. So it MUST run first: ahead of
  // electron-builder's Developer ID + notarization pass (CSC_LINK path, which
  // runs after this afterPack hook returns) AND ahead of the ad-hoc re-sign
  // below — otherwise fuse-flipping would break a signature we just applied.
  // resetAdHocDarwinSignature re-applies a valid ad-hoc signature immediately,
  // so the binary stays loadable in the gap before the real signing pass
  // (electron-builder's, or our --deep pass below) supersedes it. This runs for
  // BOTH the signed and ad-hoc paths — before the CSC_LINK early return.
  //
  // RunAsNode / EnableNodeCliInspectArguments / EnableNodeOptionsEnvironmentVariable
  // are disabled to block ELECTRON_RUN_AS_NODE, --inspect, and NODE_OPTIONS
  // code-injection into the shipped app; EnableCookieEncryption turns on
  // OS-level encryption of the cookie store at rest.
  await flipFuses(appPath, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
  });

  // When a Developer ID cert is present, electron-builder runs its own signing
  // (+ notarization) pass. Skip the ad-hoc re-sign so it can't clobber that
  // real signature. Ad-hoc is the fallback only when CSC_LINK is absent.
  if (process.env.CSC_LINK) return;
  const notifierDir = path.join(appPath, 'Contents', 'Resources', 'terminal-notifier');
  // Stash inside appOutDir (same volume as the .app) so renameSync never
  // crosses filesystems (EXDEV).
  const stash = fs.mkdtempSync(path.join(context.appOutDir, '.notifier-stash-'));
  const hasNotifier = fs.existsSync(notifierDir);

  if (hasNotifier) fs.renameSync(notifierDir, path.join(stash, 'terminal-notifier'));
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
      stdio: 'inherit',
    });
  } finally {
    if (hasNotifier) fs.renameSync(path.join(stash, 'terminal-notifier'), notifierDir);
    fs.rmSync(stash, { recursive: true, force: true });
  }
  if (hasNotifier) {
    // Reseal the outer bundle so the restored directory is covered again.
    execFileSync('codesign', ['--force', '--sign', '-', appPath], {
      stdio: 'inherit',
    });
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
      stdio: 'inherit',
    });
  }
};
