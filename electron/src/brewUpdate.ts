/**
 * Phase-2 self-update script, built as a pure string so it can be tested
 * against fake `brew`/`open` binaries.
 *
 * Success is judged by cask state (`brew outdated --cask <cask>` exits 0 when
 * installed and current), never by `brew upgrade`'s exit code: Homebrew's
 * installed-dependents check can fail on an unrelated formula and exit 1 even
 * though the cask itself upgraded.
 */

/** Skip the auto-update and the dependents check that can fail unrelated to the cask. */
export const BREW_QUIET_ENV = 'HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1';

export type Phase2Opts = {
  cask: string;
  parentPid: number;
  logFile: string;
  lockFile: string;
  failMarker: string;
};

export function buildPhase2Script(o: Phase2Opts): string {
  return [
    `if [ -f "${o.lockFile}" ]; then echo "[argus-update] phase2 already running, exiting" >> "${o.logFile}"; exit 0; fi`,
    `echo $$ > "${o.lockFile}"`,
    `rm -f "${o.failMarker}"`,
    `while kill -0 ${o.parentPid} 2>/dev/null; do sleep 0.5; done`,
    `echo "[argus-update] $(date) phase2 install" >> "${o.logFile}"`,
    `${BREW_QUIET_ENV} brew upgrade --cask ${o.cask} >> "${o.logFile}" 2>&1`,
    `BREW_EXIT=$?`,
    `rm -f "${o.lockFile}"`,
    `if HOMEBREW_NO_AUTO_UPDATE=1 brew outdated --cask ${o.cask} >/dev/null 2>&1; then`,
    `  if [ $BREW_EXIT -ne 0 ]; then echo "[argus-update] $(date) upgrade exited $BREW_EXIT but ${o.cask} is current — treating as installed" >> "${o.logFile}"; fi`,
    `  echo "[argus-update] $(date) install ok, relaunching" >> "${o.logFile}"`,
    `  open -a Argus`,
    `else`,
    `  echo "[argus-update] $(date) install failed (exit $BREW_EXIT)" >> "${o.logFile}"`,
    `  echo "$BREW_EXIT" > "${o.failMarker}"`,
    `  open -a Argus`,
    `fi`,
  ].join('\n');
}

/**
 * Phase-1 script: trust tap, update, check, download. Emits @@-prefixed markers
 * that `applyBrewUpdate` parses. The up-to-date check uses the exit code of
 * `brew outdated --cask` only; brew prints deprecation warnings on stderr, so
 * its output text is never empty and must not be used.
 */
export function buildPhase1Script(o: { cask: string; tap: string; lockFile: string }): string {
  return [
    `if [ -f "${o.lockFile}" ]; then echo "@@FAIL Another update is already running."; exit 0; fi`,
    `echo "@@PHASE trust"`,
    `brew trust ${o.tap} 2>&1`,
    `echo "@@PHASE update"`,
    `brew update 2>&1`,
    `echo "@@PHASE check"`,
    `if brew outdated --cask ${o.cask} >/dev/null 2>&1; then echo "@@UPTODATE"; exit 0; fi`,
    `echo "@@PHASE download"`,
    `brew fetch --cask ${o.cask} 2>&1`,
    `FETCH_EXIT=$?`,
    `if [ "$FETCH_EXIT" != "0" ]; then echo "@@FAIL_EXIT $FETCH_EXIT"; exit 0; fi`,
    `echo "@@OK"`,
  ].join('\n');
}
