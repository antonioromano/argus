---
title: Notifications from an ad-hoc signed app — vendored terminal-notifier, click routing, stray Terminal windows
date: 2026-07-24
category: docs/solutions/macos/
module: electron, server, client
problem_type: integration_bug
component: terminal-notifier, electron/afterPack.cjs, useNotifications, StateDetector prompt extraction
severity: high
applies_when:
  - Notifications don't appear in the packaged app
  - Clicking a notification opens Terminal.app
  - Touching the vendored notifier, its bundle id, or the afterPack re-sign
  - Notification text shows only the app/session name
tags:
  - notifications
  - terminal-notifier
  - launchservices
  - ad-hoc-signing
  - macos
---

## Delivery

- On macOS Sequoia, `usernoted` silently drops posts attributed to untrusted (ad-hoc) bundles. That
  covers Electron's `Notification` **and** `osascript display notification`, which is attributed to
  the responsible process (the app) and exits 0 anyway.
- A spawned `.app` bundle gets its own attribution, so a vendored universal `terminal-notifier.app`
  (`electron/resources/terminal-notifier/`, shipped as an extraResource) does deliver.
- **Never change the notifier's bundle id, name or .app filename.** Doing so permanently broke
  delivery. The entry still showed in System Settings, toggled on, and posts were still dropped.
  Swapping only the icon and re-signing is fine.
- `electron/afterPack.cjs` moves the notifier out of the bundle during the ad-hoc `--deep` re-sign,
  puts it back, and then reseals the outer app without `--deep`. This keeps the notifier's CDHash
  byte-identical across releases, which matters because permission grants bind to its code identity.

## Click routing: use `-open URL`

- `-execute CMD` runs through `/bin/sh`. Without `-activate`, terminal-notifier falls back to its
  hardcoded default `com.apple.Terminal`, so every click opened a stray Terminal window.
- `-sender ID` only sets the banner icon and attribution, never the click target. It also lets macOS
  suppress the banner while the sender app is frontmost, which broke the Settings test button.
- **Fix:** `-open "<scheme>://notif/<id>"`. LaunchServices activates the scheme owner (Argus) with no
  shell and no Terminal fallback.

## Stray Terminal at post time: LaunchServices bundle-id collision

The vendored notifier keeps the generic id `fr.julienxx.oss.terminal-notifier`, which other copies on
the machine share (Homebrew, node-notifier). If LaunchServices resolves that id to a dead path,
`usernoted` logs `Failed to source application bundle` and launches Terminal.app to present the banner.

- **Ship defence:** background notifications pass `attributeToApp: true`, and main adds
  `-sender <Argus bundle id>`. Real notifications only fire while Argus is unfocused, so there is no
  frontmost suppression. The Settings test button omits it on purpose.
- **Diagnose:**
  - `log show --predicate 'process=="usernoted"' | grep "source application"`
  - `lsregister -dump | grep terminal-notifier.app`. The first path listed is the preferred binding;
    if it no longer exists on disk, that's the bug.
- **Machine fix:** `lsregister -kill -r -domain local -domain system -domain user`.

Other flags: `-appIcon` is ignored on modern macOS, `-contentImage` works, `-group` replaces a
notification and `-remove` dismisses it.

## Content: prompt text must self-heal

`waiting` can trigger (from a cursor-shape hint) before the menu paints, so a one-shot prompt
extraction returned nothing and the body was just "argus". StateDetector re-extracts on later settles
while it stays waiting (`onPromptUpdate`; it never downgrades text to undefined), SessionManager
re-emits `session:status`, and the client silently replaces the notification with the same id.
Extraction scans 25 rows, more than the 15 used for state, so tall menus fit. The fallback body is
"Waiting for your input — <name>".
