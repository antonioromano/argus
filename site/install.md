---
title: Install
permalink: /install/
---

# Install

## Homebrew

```bash
brew tap antonioromano/argus https://github.com/antonioromano/argus && \
  brew trust antonioromano/argus && \
  brew install --cask argus
```

Launch Argus from Spotlight or your Applications folder.

Homebrew 4.x refuses to load casks from third-party taps until you trust them once. Without `brew trust` you see `Refusing to load cask ... from untrusted tap`. Trust is one-time per machine.

Homebrew installs skip the Gatekeeper steps below: the cask strips the macOS quarantine flag, so the app opens normally.

## Update

```bash
brew upgrade --cask argus
```

If `brew upgrade` reports an untrusted tap, run `brew trust antonioromano/argus` once and retry. The in-app "Update now" button trusts the tap for you.

## First launch from the DMG {#first-launch}

Argus is ad-hoc signed, so macOS Gatekeeper blocks a DMG download the first time. You can allow it for free:

1. Download the DMG from GitHub Releases.
2. Drag Argus to Applications.
3. Try to open Argus once. macOS blocks it with a message like "Apple could not verify...".
4. Open System Settings, then Privacy & Security.
5. Scroll to the "Argus was blocked" message and click Open Anyway.
6. Confirm with your password or Touch ID.

On macOS 15 and later, right-click then Open no longer bypasses this. Use Privacy & Security.

Terminal alternative:

```bash
xattr -dr com.apple.quarantine /Applications/Argus.app
```
