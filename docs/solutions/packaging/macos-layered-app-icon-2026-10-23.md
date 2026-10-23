---
title: macOS 26 Dark / Tinted / Clear app icon (Icon Composer .icon → Assets.car)
date: 2026-10-23
category: docs/solutions/packaging/
module: build
problem_type: ui_bug
component: electron/assets/Argus.icon, scripts/build-icon.mjs, electron-builder.config.cjs
severity: low
applies_when:
  - Changing the app icon
  - The Dock/Finder icon looks wrong in a macOS icon appearance
---

## Problem

With macOS 26 "Dark" icons, the flat `.icns` (black spartan on amber) was
darkened by the system into black-on-black. A `.icns` holds a single bitmap; the
system can only render per-appearance variants from an **asset catalog** built
from an Icon Composer document.

## Solution

- `electron/assets/Argus.icon` — Icon Composer document. Background is a fill
  (amber, `dark` → #1A1A1A); the glyph is two separate layers (`crest.svg`,
  `helmet.svg` with the eye slits cut out via `evenodd`) whose fill flips to
  amber in `dark` and to white in `tinted` (Tinted and Clear derive from it).
- `npm run build:icon` runs `xcrun actool` (Xcode 26+) and writes the
  **committed** `electron/assets/Assets.car`, `Argus.icns` and `Assets.car.sha256`
  (hash of the `.icon` sources + actool flags; `.gitattributes` keeps the sources
  out of EOL normalization). CI doesn't need Xcode 26;
  `electron/src/appIcon.test.ts` fails if either changed without a recompile.
- `electron-builder.config.cjs` ships it via `extraResources` →
  `Contents/Resources/Assets.car` and sets `mac.extendInfo.CFBundleIconName:
  'Argus'` (must equal the `.icon` basename). `mac.icon: Argus.icns` (actool's
  render of the same layers) becomes `icon.icns` / `CFBundleIconFile`, the fallback.
- `electron/src/main.ts` only calls `app.dock.setIcon()` in dev: on a packaged
  build it would replace the bundle icon with a flat bitmap while the app runs.

Preview every appearance without opening Icon Composer:

```bash
"/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool" \
  electron/assets/Argus.icon --export-image --output-file /tmp/dark.png \
  --platform macOS --rendition Dark --width 512 --height 512 --scale 1
```

Renditions: `Default`, `Dark`, `TintedLight`, `TintedDark`, `ClearLight`, `ClearDark`.

## Gotchas

- The Dock caches icons: after installing a new build, `touch /Applications/Argus.app`
  and `killall Dock` before judging the result.
- electron-builder 25 has no native `.icon` support (added in 26) — hence the
  manual actool step and `extendInfo`.
