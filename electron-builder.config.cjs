// electron-builder configuration.
//
// Signing is conditional on a Developer ID certificate being available in the
// environment (CSC_LINK = base64 .p12, CSC_KEY_PASSWORD = its password). When
// present, the bundle is signed with the hardened runtime and notarized so
// macOS will trust it on every Mac — a prerequisite for the OS to deliver
// native notifications. When absent (local dev, forks without secrets), we fall
// back to the previous ad-hoc signature via electron/afterPack.cjs so the app
// still loads. This keeps releases working before the cert/secrets are added.

const hasSigningCert = !!process.env.CSC_LINK;

// Notarization needs either an App Store Connect API key or an Apple ID +
// app-specific password. electron-builder reads these from env automatically;
// we only flip `notarize` on when one of the credential sets is present.
const canNotarize =
  hasSigningCert &&
  (!!process.env.APPLE_API_KEY ||
    (!!process.env.APPLE_ID && !!process.env.APPLE_APP_SPECIFIC_PASSWORD));

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.antonio.argus',
  productName: 'Argus',
  // Custom URL scheme so a clicked notification can deep-link the session id back
  // into the app. terminal-notifier's click runs `open argus://notif/<id>`, which
  // activates Argus and fires the main-process `open-url` handler. electron-builder
  // writes the matching CFBundleURLTypes into Info.plist.
  protocols: [{ name: 'Argus', schemes: ['argus'] }],
  files: [
    'electron/dist/**',
    'server/dist/**',
    'client/dist/**',
    'shared/dist/**',
    'node_modules/**',
    'package.json',
  ],
  // The ripgrep binary (server symbol search) ships inside @vscode/ripgrep's
  // per-platform package. Unpack it from the asar so it stays executable; the
  // server rewrites rgPath app.asar → app.asar.unpacked at runtime (see
  // server/src/utils/ripgrep.ts). grep is the fallback when it can't run.
  asarUnpack: ['**/node_modules/@vscode/ripgrep*/**'],
  extraResources: [
    {
      from: 'electron/resources/tmux',
      to: 'tmux',
      filter: ['**/*'],
    },
    // Developer-ID-independent notification delivery for ad-hoc builds (see
    // electron/resources/terminal-notifier/README.md). afterPack.cjs excludes
    // this bundle from the ad-hoc deep re-sign to keep its signature stable.
    {
      from: 'electron/resources/terminal-notifier',
      to: 'terminal-notifier',
      filter: ['**/*'],
    },
    // Native agent-signal transport script (plan 2026-07-22-001). Resolved at
    // runtime as resourcesPath/bin/argus-signal (see resolveSignalBin). A POSIX
    // sh script — interpreted, not a Mach-O binary — so it needs no code-signing;
    // afterPack's ad-hoc binary re-sign leaves it alone.
    {
      from: 'resources/bin',
      to: 'bin',
      filter: ['argus-signal'],
    },
  ],
  mac: {
    category: 'public.app-category.developer-tools',
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    icon: 'electron/assets/icon.png',
    // null forces ad-hoc; undefined lets electron-builder pick the imported
    // Developer ID Application identity from the temp keychain.
    identity: hasSigningCert ? undefined : null,
    hardenedRuntime: hasSigningCert,
    gatekeeperAssess: false,
    ...(hasSigningCert
      ? {
          entitlements: 'electron/entitlements.mac.plist',
          entitlementsInherit: 'electron/entitlements.mac.plist',
        }
      : {}),
    notarize: canNotarize,
  },
  dmg: {
    title: 'Argus ${arch}',
    background: null,
    icon: null,
    writeUpdateInfo: false,
  },
  // NOTE: Electron-fuse hardening (U3) is deferred — the `electronFuses` config
  // key requires electron-builder 26.x; this repo is on 25.1.8 (it failed config
  // validation and blocked the release). Re-do via @electron/fuses in an
  // afterPack step ordered BEFORE signing, or after an eb 26 upgrade — both need
  // a packaged-build verification.
  // afterPack ad-hoc re-signs ONLY in the unsigned fallback (it no-ops when a
  // real signing pass runs, so it can't clobber the Developer ID signature).
  afterPack: 'electron/afterPack.cjs',
};
