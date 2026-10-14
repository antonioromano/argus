---
title: "Argus wants to use … 'Argus Safe Storage'" keychain prompt after every update
date: 2026-06-10
category: docs/solutions/macos/
module: electron
problem_type: configuration_bug
component: electron/src/main.ts command-line switches
severity: medium
applies_when:
  - Users see a keychain prompt for "Argus Safe Storage" on launch or after an update
  - Changing Chromium command-line switches in Electron main
  - Changing code signing (ad-hoc vs Developer ID)
tags:
  - keychain
  - oscrypt
  - ad-hoc-signing
  - electron
---

## Cause

The prompt comes from **Chromium's OSCrypt**, which encrypts the cookie and local-state store. Argus
code uses no `safeStorage` or keytar. macOS binds that keychain item's ACL to the app's code-signing
identity. Argus releases are ad-hoc signed, so every update has a new cdhash, the keychain sees a new
app, and it prompts again.

## Fix

In `electron/src/main.ts`, before app `ready`:

- `app.commandLine.appendSwitch('use-mock-keychain')` is **the macOS lever**. OSCrypt uses an in-memory
  key instead of the real Keychain, so there is no prompt under any signature.
- `appendSwitch('password-store', 'basic')` is **Linux-only** and does nothing on macOS. It was
  shipped as "the fix" in 0.17.1 and 0.17.3 by mistake; 0.17.4 corrected it.

This is safe because Argus keeps no sensitive cookie data: it loads 127.0.0.1 and keeps state in
localStorage. Refs electron/electron#40236 and #43233.
