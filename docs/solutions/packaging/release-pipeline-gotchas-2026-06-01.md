---
title: Release pipeline gotchas (tag-triggered DMG build, signing, cask bump)
date: 2026-06-01
category: docs/solutions/packaging/
module: build, ci
problem_type: build_error
component: .github/workflows/release.yml, electron-builder.config.cjs, electron/afterPack.cjs, Casks/argus.rb
severity: high
applies_when:
  - Editing release.yml, package:mac or electron-builder config
  - A tag push failed or produced a broken / "damaged" app
  - Recovering a release whose cask bump did not land
tags:
  - release
  - github-actions
  - electron-builder
  - codesign
  - homebrew
  - dmg
---

`release.yml` runs **only on a `v*` tag push**. It gates, packages both DMGs, smoke-boots the app,
uploads the release, and bumps `Casks/argus.rb`.

## Things that broke it

1. **A committed `*.tsbuildinfo`.** Fresh checkouts skipped emitting `shared/dist/types.d.ts`
   (TS6305). Keep it gitignored.
2. **electron-builder without `-p never`** auto-publishes on a CI tag and dies on a missing `GH_TOKEN`.
   Uploading is `softprops/action-gh-release`'s job.
3. **Identical DMG volume names.** arm64 and x64 DMGs build in parallel and collided on `/Volumes/Argus`
   (`hdiutil detach … resource busy`). `dmg.title` must include `${arch}`. Filenames come from
   `artifactName`, so the cask URLs don't change.
4. **Runner choice.** `macos-15` (arm64) picks up in seconds; Intel `macos-13` queued for 24+ minutes.
5. **"Argus is damaged".** With `mac.identity: null`, electron-builder skips the bundle codesign pass,
   leaving only the linker's bare signature (`Sealed Resources=none`), which is invalid on arm64.
   `electron/afterPack.cjs` ad-hoc signs the whole bundle. Verify with
   `codesign --verify --deep --strict` (exit 0) and `Sealed Resources version=2`. `spctl` still says
   "rejected" without a Developer ID; that's fine.
6. **Python 3.12+ has no `distutils`.** node-gyp needs it when `install-app-deps` rebuilds node-pty.
   Pin Python 3.11 in CI.
7. **Root-dep bundling.** See `packaged-app-crash-missing-root-deps-2026-08-26.md`.
8. **Tag the exact pushed `main` HEAD, and push `main` first.** Rebasing after tagging leaves the tag
   on a commit that is not on `main`. The cask step used to push from the tag's detached HEAD and was
   rejected non-fast-forward; it now bases the cask commit on `origin/main`, but a tag off `main`
   still ships code that `main` doesn't have. Correct order: commit → `git push origin main` →
   `git tag vX <main HEAD>` → `git push origin vX`.

## Recovery

- **The run failed before the upload step.** Nothing was published, so move the tag in place:
  `git push origin :refs/tags/vX && git tag -d vX && git tag vX && git push origin vX`.
- **The cask bump is missing.** The SHA-256s are in the failed run's log
  (`gh run view <id> --log-failed`), or recompute them with `shasum -a 256` on the published DMGs. Edit
  `Casks/argus.rb` (version + both sha256) and land it on `main`.
- **A tag push spawned two runs.** Cancel one, so two cask bumps don't race.

## Homebrew notes

- The tap `antonioromano/argus` reads casks straight from this repo's `Casks/` on `main`.
- After a release, `brew upgrade --cask argus` can report "already upgraded" until `brew update`
  refreshes the tap.
- The cask's `postflight` runs `xattr -cr` to strip quarantine. The CI bump regex preserves it.
