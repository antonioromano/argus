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
  files: [
    'electron/dist/**',
    'server/dist/**',
    'client/dist/**',
    'shared/dist/**',
    'node_modules/**',
    'package.json',
  ],
  extraResources: [
    {
      from: 'electron/resources/tmux',
      to: 'tmux',
      filter: ['**/*'],
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
  // afterPack ad-hoc re-signs ONLY in the unsigned fallback (it no-ops when a
  // real signing pass runs, so it can't clobber the Developer ID signature).
  afterPack: 'electron/afterPack.cjs',
};
