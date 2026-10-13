---
title: Packaged app crashes at launch with ERR_MODULE_NOT_FOUND — root-dep bundling and @argus/* value imports
date: 2026-08-26
category: docs/solutions/packaging/
module: server, electron, build
problem_type: build_error
component: electron-builder, app.asar, scripts/check-dep-sync.mjs, release.yml smoke test
severity: critical
applies_when:
  - Adding a runtime dependency to server/ or electron/
  - Importing anything from @argus/shared in server/ or electron/ code
  - Changing the release smoke test or verifying a packaged build
tags:
  - packaging
  - electron-builder
  - asar
  - check-deps
  - err-module-not-found
  - release
---

## Symptom

The DMG installs, then Argus never opens. Launching the binary directly
(`/Applications/Argus.app/Contents/MacOS/Argus`) shows
`ERR_MODULE_NOT_FOUND: Cannot find package '<x>'` from `server/dist/...` before any window appears.
All tests were green.

## Root causes (five shipped instances)

1. **Server dep missing from the root `package.json`.** electron-builder bundles the **root**
   production dependency tree into `app.asar`. A dep listed only in `server/package.json` resolves in
   dev (hoisted to root `node_modules`) but is pruned from the asar.
   - v0.21.0 / v0.21.1: `@xterm/addon-serialize`.
   - `@vscode/ripgrep` was server-only too. It didn't crash, it **silently degraded** packaged symbol
     search to grep. Lazy imports and fallbacks hide this class from a boot test.
2. **A *value* import from `@argus/shared` in server or electron code.** `import type` erases at
   compile time. A value import emits a real module load, and `app.asar` has **no
   `node_modules/@argus`**.
   - v0.22.5: `SESSION_NAME_MAX`.
   - v0.23.0: `MAIN_WINDOW_ID`, in five files on a multi-window branch.
   - Fix: duplicate the value under `server/src/constants/` and register the pair in
     `scripts/check-dep-sync.mjs` so the copies can't drift.
3. **A smoke test that passed for a broken build.** The release step booted `dist/mac-arm64/Argus.app`
   inside the checkout. Node resolves bare specifiers by walking **ancestor directories**, so the app
   borrowed the repo's own `node_modules` and booted fine in CI, while it could not start from
   `/Applications`.

## Guards (keep them)

- `npm run check:deps` checks: server deps ⊆ root deps; no server/electron value imports of `@argus/*`;
  duplicated constants still agree. It runs first
  in `build:all`, `package:mac`, CI and release.
- `npm run verify` is the local pre-commit gate. `npm test` alone does **not** run `check:deps`.
  v0.23.0 passed a whole review pipeline and failed only at the tag push.
- The release workflow copies the `.app` to a `mktemp -d /tmp/...` directory, asserts that no ancestor
  has a `node_modules`, then requires `/api/health` on 5757.

## Verify a fix locally

`electron-builder --mac --dir`, copy the `.app` **outside the repo**, run its binary, and confirm
`Server running on …` appears with no `ERR_MODULE_NOT_FOUND`.
