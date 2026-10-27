import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPhase2Script } from './brewUpdate.js';

type Fake = { upgradeExit: number; outdatedExit: number; stderr?: string };

const readOr = (p: string, d: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : d);

/** Runs the real phase-2 script under /bin/sh with fake `brew` and `open` on PATH. */
function runPhase2(fake: Fake, opts: { lockExists?: boolean } = {}) {
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

  const script = buildPhase2Script({
    cask: 'argus',
    parentPid: spawnSync('true').pid ?? 999999, // a finished process: the wait loop exits at once
    logFile,
    lockFile,
    failMarker,
  });
  spawnSync('/bin/sh', ['-c', script], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });

  return {
    calls: readOr(callsLog, ''),
    opens: readOr(openLog, ''),
    marker: existsSync(failMarker) ? readFileSync(failMarker, 'utf8').trim() : null,
    log: readOr(logFile, ''),
    lockExistsAfter: existsSync(lockFile),
  };
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
