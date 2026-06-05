# Vendored terminal-notifier

`terminal-notifier.app` delivers macOS notifications for **packaged** (ad-hoc signed) Argus builds.

## Why it exists

Packaged Argus is ad-hoc signed (no Developer ID cert). macOS's `usernoted` daemon
silently drops notification posts attributed to an untrusted bundle — both Electron's
native `Notification` API **and** `osascript display notification` (osascript posts are
attributed to the *responsible process*, i.e. Argus itself, so the 0.16.42 osascript
workaround never actually delivered).

terminal-notifier is its own `.app` bundle, so notifications it posts are attributed to
*it*, not to Argus. macOS prompts the user once to allow "terminal-notifier"
notifications; after that, delivery works regardless of Argus's signature.

## Provenance

- Upstream: https://github.com/julienXX/terminal-notifier, release **2.0.0**
  (`terminal-notifier-2.0.0.zip`) — provides the bundle structure and the x86_64 slice.
- arm64 slice: Homebrew bottle `terminal-notifier--2.0.0.arm64_sequoia` (built by
  Homebrew CI from the same upstream source).
- The two slices were combined with `lipo -create` into a universal binary,
  `Contents/Resources/Terminal.icns` was replaced with the Argus spartan icon
  (generated from `electron/assets/icon_spartan_amber_v2_1024.png` via
  `sips` + `iconutil`; the filename stays `Terminal.icns` so Info.plist is
  untouched), then the bundle was ad-hoc signed
  (`codesign --force --deep --sign -`) to seal resources:

```
Identifier=fr.julienxx.oss.terminal-notifier
Format=app bundle with Mach-O universal (x86_64 arm64)
Signature=adhoc
Sealed Resources version=2 rules=13 files=4
```

## Do NOT

- **Do not re-sign this bundle per build.** Notification permission binds to the bundle's
  code identity; a changing signature breaks the user's existing grant.
  `electron/afterPack.cjs` deliberately excludes it from the ad-hoc deep re-sign.
- **Do not change the bundle id, name, or .app filename.** Empirically (2026-06-05,
  macOS Sequoia), a rebranded copy (`com.antonio.argus.notifier`) registered in
  System Settings but `usernoted` never delivered its posts, even after
  LaunchServices cleanup and daemon restarts. The pristine upstream identity
  delivers reliably. Icon-only swaps (re-signed, same id/name/filename) survive
  fine — that's how the spartan icon got in. `-appIcon` is ignored on modern macOS,
  and the banner icon resolves via the bundle id to the *installed* copy under
  /Applications, so icon changes only show up after a reinstall.
