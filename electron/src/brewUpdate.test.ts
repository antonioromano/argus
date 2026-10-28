import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCaskCurrentCheck, buildPhase1Script, buildPhase2Script } from './brewUpdate.js';

type Fake = { upgradeExit: number; outdatedExit: number; stderr?: string };

const readOr = (p: string, d: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : d);

/** Runs the real phase-2 script under /bin/sh with fake `brew` and `open` on PATH. */
function runPhase2(fake: Fake, opts: { lockExists?: boolean; markerExists?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'brewupdate-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const callsLog = join(dir, 'calls.log');
  const openLog = join(dir, 'open.log');
  const logFile = join(dir, 'update.log');
  const lockFile = join(dir, 'update.lock');
  const failMarker = join(dir, 'update.failed');

  writeFileSync(
    join(bin, 'brew'),
    [
      '#!/bin/sh',
      `echo "$@ NO_INSTALLED_DEPENDENTS_CHECK=$HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK NO_AUTO_UPDATE=$HOMEBREW_NO_AUTO_UPDATE" >> "${callsLog}"`,
      fake.stderr ? `echo '${fake.stderr}' >&2` : ':',
      `case "$1" in upgrade) exit ${fake.upgradeExit};; outdated) exit ${fake.outdatedExit};; esac`,
      'exit 0',
    ].join('\n'),
  );
  writeFileSync(join(bin, 'open'), `#!/bin/sh\necho "$@" >> "${openLog}"\n`);
  chmodSync(join(bin, 'brew'), 0o755);
  chmodSync(join(bin, 'open'), 0o755);
  if (opts.lockExists) writeFileSync(lockFile, '1');
  if (opts.markerExists) writeFileSync(failMarker, '1');

  const script = buildPhase2Script({
    cask: 'argus',
    parentPid: spawnSync('true').pid ?? 999999, // a finished process: the wait loop exits at once
    logFile,
    lockFile,
    failMarker,
  });
  try {
    spawnSync('/bin/sh', ['-c', script], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    return {
      calls: readOr(callsLog, ''),
      opens: readOr(openLog, ''),
      marker: existsSync(failMarker) ? readFileSync(failMarker, 'utf8').trim() : null,
      log: readOr(logFile, ''),
      lockExistsAfter: existsSync(lockFile),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('clean upgrade → relaunch, no marker', () => {
  const r = runPhase2({ upgradeExit: 0, outdatedExit: 0 });
  assert.equal(r.marker, null);
  assert.match(r.opens, /-a Argus/);
  assert.equal(r.lockExistsAfter, false);
  assert.match(r.log, /install ok, relaunching/);
});

test('upgrade exit 1 but cask current → success', () => {
  const r = runPhase2({ upgradeExit: 1, outdatedExit: 0 });
  assert.equal(r.marker, null);
  assert.match(r.log, /upgrade exited 1 but argus is current/);
  assert.match(r.opens, /-a Argus/);
});

test('real failure writes marker', () => {
  const r = runPhase2({ upgradeExit: 1, outdatedExit: 1 });
  assert.equal(r.marker, '1');
  assert.match(r.log, /install failed \(exit 1\)/);
  assert.match(r.opens, /-a Argus/);
  assert.equal(r.lockExistsAfter, false);
});

test('marker from an earlier failure is cleared by a clean run', () => {
  const r = runPhase2({ upgradeExit: 0, outdatedExit: 0 }, { markerExists: true });
  assert.equal(r.marker, null);
});

test('exit 0 but still outdated writes marker', () => {
  const r = runPhase2({ upgradeExit: 0, outdatedExit: 1 });
  assert.equal(r.marker, '0');
  assert.match(r.opens, /-a Argus/);
});

test('stderr noise does not mark failure', () => {
  const r = runPhase2({ upgradeExit: 0, outdatedExit: 0, stderr: 'Warning: Calling `postflight` is deprecated!' });
  assert.equal(r.marker, null);
});

test('upgrade sees env', () => {
  const r = runPhase2({ upgradeExit: 0, outdatedExit: 0 });
  const line = r.calls.split('\n').find((l) => l.startsWith('upgrade --cask argus'));
  assert.ok(line, 'upgrade call recorded');
  assert.match(line, /NO_INSTALLED_DEPENDENTS_CHECK=1/);
  assert.match(line, /NO_AUTO_UPDATE=1/);
});

test('lock present exits without running brew', () => {
  const r = runPhase2({ upgradeExit: 0, outdatedExit: 0 }, { lockExists: true });
  assert.equal(r.calls, '');
  assert.match(r.log, /phase2 already running/);
});

type Phase1Fake = { outdatedExit: number; fetchExit?: number };

/** Runs the real phase-1 script under /bin/sh with a fake `brew` that always warns on stderr. */
function runPhase1(fake: Phase1Fake, opts: { lockExists?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'brewupdate1-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const callsLog = join(dir, 'calls.log');
  const lockFile = join(dir, 'update.lock');
  writeFileSync(
    join(bin, 'brew'),
    [
      '#!/bin/sh',
      `echo "$@" >> "${callsLog}"`,
      `echo 'Warning: Calling \`postflight\` is deprecated!' >&2`,
      `case "$1" in outdated) exit ${fake.outdatedExit};; fetch) exit ${fake.fetchExit ?? 0};; esac`,
      'exit 0',
    ].join('\n'),
  );
  chmodSync(join(bin, 'brew'), 0o755);
  if (opts.lockExists) writeFileSync(lockFile, '1');
  const script = buildPhase1Script({ cask: 'argus', tap: 'rbly/argus', lockFile });
  try {
    const r = spawnSync('/bin/sh', ['-c', script], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: 'utf8',
    });
    return { stdout: r.stdout, calls: readOr(callsLog, '') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('phase1: up to date despite stderr warning', () => {
  const r = runPhase1({ outdatedExit: 0 });
  assert.match(r.stdout, /@@UPTODATE/);
  assert.doesNotMatch(r.calls, /fetch/);
});

test('phase1: outdated → fetch then @@OK', () => {
  const r = runPhase1({ outdatedExit: 1 });
  assert.match(r.calls, /fetch --cask argus/);
  assert.match(r.stdout.trim(), /@@OK$/);
  assert.doesNotMatch(r.stdout, /@@UPTODATE/);
});

test('phase1: fetch failure → @@FAIL_EXIT', () => {
  const r = runPhase1({ outdatedExit: 1, fetchExit: 2 });
  assert.match(r.stdout, /@@FAIL_EXIT 2/);
  assert.doesNotMatch(r.stdout, /@@OK/);
});

test('phase1: lock present → @@FAIL', () => {
  const r = runPhase1({ outdatedExit: 1 }, { lockExists: true });
  assert.match(r.stdout, /@@FAIL Another update is already running\./);
  assert.equal(r.calls, '');
});

/** Runs the cask-current check under /bin/sh with a fake `brew` that records its env. */
function runCheck(outdatedExit: number) {
  const dir = mkdtempSync(join(tmpdir(), 'brewcheck-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const callsLog = join(dir, 'calls.log');
  writeFileSync(
    join(bin, 'brew'),
    [
      '#!/bin/sh',
      `echo "$@ NO_AUTO_UPDATE=$HOMEBREW_NO_AUTO_UPDATE" >> "${callsLog}"`,
      `case "$1" in outdated) exit ${outdatedExit};; esac`,
      'exit 0',
    ].join('\n'),
  );
  chmodSync(join(bin, 'brew'), 0o755);
  try {
    const r = spawnSync('/bin/sh', ['-c', buildCaskCurrentCheck('argus')], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    return { status: r.status, calls: readOr(callsLog, '') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('cask check: exits 0 when cask is current', () => {
  assert.equal(runCheck(0).status, 0);
});

test('cask check: exits 1 when cask is outdated', () => {
  assert.equal(runCheck(1).status, 1);
});

test('cask check: runs outdated --cask with NO_AUTO_UPDATE=1', () => {
  assert.match(runCheck(0).calls, /outdated --cask argus NO_AUTO_UPDATE=1/);
});
