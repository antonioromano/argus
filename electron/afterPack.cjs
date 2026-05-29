const { execFileSync } = require('node:child_process');
const path = require('node:path');

// electron-builder skips the bundle codesign pass when mac.identity is null,
// leaving only the linker's bare ad-hoc signature on the inner Electron binary
// (Sealed Resources=none) — an invalid signature that macOS reports as
// "damaged" on Apple Silicon. Re-sign the whole .app ad-hoc here (afterPack
// runs before DMG packaging) so resources are sealed and the bundle loads.
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  });
};
