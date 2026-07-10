import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { ChildProcess } from 'node:child_process';

const { NgrokService } = await import('./NgrokService.js');

// NgrokService spawns the real `ngrok` binary via child_process.spawn. Rather
// than mock the ESM import (its bindings aren't writable), we point the service
// at a throwaway shell script that stands in for the binary and neutralise the
// real localhost:4040 discovery poll so the test never touches the network.
function makeFakeNgrok(body: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'argus-ngrok-'));
  const path = join(dir, 'fake-ngrok');
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function makeService(ngrokPath: string): InstanceType<typeof NgrokService> {
  const svc = new NgrokService();
  // Inject our fake binary and stub the initial "reuse an existing tunnel"
  // poll so start() always proceeds to spawn (and never hits the network).
  (svc as unknown as { ngrokPath: string }).ngrokPath = ngrokPath;
  (svc as unknown as { pollNgrokApi: () => Promise<string | null> }).pollNgrokApi =
    async () => null;
  return svc;
}

function getProcess(svc: InstanceType<typeof NgrokService>): ChildProcess | null {
  return (svc as unknown as { process: ChildProcess | null }).process;
}

// Error path: the ngrok child dies before the first successful poll (e.g. a bad
// authtoken on first run). Before the fix, the exit handler cleared the poll
// interval without settling the pending start() promise, so start() hung
// forever. The tight timeout proves it now settles quickly rather than waiting
// out the ~20s MAX_POLL_ATTEMPTS budget.
test('start() rejects when ngrok exits before the first successful poll', { timeout: 3000 }, async () => {
  const fake = makeFakeNgrok('echo "ERR_NGROK_4018 authtoken invalid" >&2\nexit 1');
  const svc = makeService(fake.path);
  try {
    await assert.rejects(svc.start(5401), /ngrok|authentication|authtoken|exited/i);
    // Status reflects the failure instead of being stuck on 'connecting'.
    assert.equal(svc.getStatus().tunnelStatus, 'error');
    // The interval must have been torn down — no dangling process handle.
    assert.equal(getProcess(svc), null);
  } finally {
    fake.cleanup();
  }
});

// Edge: stop() lands while a start() is still connecting. stop() must reject the
// pending start exactly once; the child's later SIGTERM-driven 'exit' must not
// double-settle the (already settled) promise or throw on a nulled reject.
test('stop() during connect settles the pending start() exactly once', { timeout: 3000 }, async () => {
  // A fake ngrok that stays alive keeps start() in its polling phase. `exec`
  // replaces the shell with `sleep` in-place instead of forking it, so
  // SIGTERM to this one process actually kills it — a plain `sleep 30`
  // leaves an orphaned grandchild holding the inherited stdio pipe open
  // for the full 30s after the shell dies, hanging this file's teardown.
  const fake = makeFakeNgrok('exec sleep 30');
  const svc = makeService(fake.path);
  try {
    const startPromise = svc.start(5401);
    // Attach the rejection expectation synchronously so the eventual rejection
    // is never unhandled.
    const rejected = assert.rejects(startPromise, /stopped while connecting/);

    // Let start() spawn the child and register pendingStartReject.
    await new Promise((r) => setTimeout(r, 30));
    const child = getProcess(svc);
    assert.ok(child, 'expected a spawned child process while connecting');

    await svc.stop(); // rejects the pending start once
    await rejected;

    // The child now dies from SIGTERM; its late 'exit' must be a no-op.
    await once(child!, 'exit');
    assert.equal(svc.getStatus().tunnelStatus, 'disconnected');

    // A second stop() must also be a harmless no-op (reject already nulled).
    await svc.stop();
    assert.equal(svc.getStatus().tunnelStatus, 'disconnected');
  } finally {
    await svc.stop();
    fake.cleanup();
  }
});
