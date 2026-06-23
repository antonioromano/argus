import { test } from 'node:test';
import assert from 'node:assert/strict';

// The Electron self-update branch only runs when process.versions.electron is
// set. node:test runs each file in its own process, so stubbing it here is safe.
(process.versions as Record<string, string>).electron = '99.0.0';

const { UpdateService } = await import('./UpdateService.js');
import type { UpdateProgress } from '@argus/shared';

interface Emitted { event: string; payload?: unknown }

function makeService() {
  const emitted: Emitted[] = [];
  const io = { emit: (event: string, payload?: unknown) => { emitted.push({ event, payload }); } };
  const svc = new UpdateService();
  // Minimal io stub — UpdateService only calls io.emit().
  svc.setIo(io as unknown as Parameters<typeof svc.setIo>[0]);
  return { svc, emitted };
}

const events = (e: Emitted[]) => e.map((x) => x.event);

test('relays progress and emits update:applying when a download starts', async () => {
  const { svc, emitted } = makeService();
  svc.setApplyUpdateFn(async (onProgress) => {
    onProgress({ phase: 'trust', label: 'Trusting tap…' });
    onProgress({ phase: 'download', label: 'Downloading 50%', percent: 50 });
    return { success: true };
  });

  const result = await svc.applyUpdate();

  assert.deepEqual(result, { success: true });
  assert.deepEqual(events(emitted), ['update:progress', 'update:progress', 'update:applying']);
  assert.deepEqual((emitted[1].payload as UpdateProgress).percent, 50);
});

test('emits update:failed for a background download failure and clears the guard', async () => {
  const { svc, emitted } = makeService();
  svc.setApplyUpdateFn(async (_onProgress, onResult) => {
    // Download started, then failed in the background while the app stays open.
    onResult({ success: false, error: 'curl: connection reset' });
    return { success: true };
  });

  await svc.applyUpdate();

  const failed = emitted.find((e) => e.event === 'update:failed');
  assert.ok(failed, 'update:failed should be emitted');
  assert.deepEqual(failed!.payload, { error: 'curl: connection reset', upToDate: undefined });

  // Guard must be cleared — a second apply should proceed, not be rejected.
  let secondRan = false;
  svc.setApplyUpdateFn(async () => { secondRan = true; return { success: true }; });
  await svc.applyUpdate();
  assert.equal(secondRan, true);
});

test('surfaces an already-up-to-date result as a non-error failed event', async () => {
  const { svc, emitted } = makeService();
  svc.setApplyUpdateFn(async (_onProgress, onResult) => {
    onResult({ success: false, upToDate: true, error: 'Argus is already up to date.' });
    return { success: true };
  });

  await svc.applyUpdate();

  const failed = emitted.find((e) => e.event === 'update:failed');
  assert.ok(failed);
  assert.deepEqual((failed!.payload as { upToDate?: boolean }).upToDate, true);
});

test('a fast failure (brew missing) emits update:failed and returns the error', async () => {
  const { svc, emitted } = makeService();
  svc.setApplyUpdateFn(async () => ({ success: false, error: 'Homebrew not found.' }));

  const result = await svc.applyUpdate();

  assert.equal(result.success, false);
  assert.equal(result.error, 'Homebrew not found.');
  const failed = emitted.find((e) => e.event === 'update:failed');
  assert.deepEqual(failed!.payload, { error: 'Homebrew not found.', upToDate: undefined });
});

test('rejects a concurrent apply while one is in progress', async () => {
  const { svc } = makeService();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  svc.setApplyUpdateFn(async () => { await gate; return { success: true }; });

  const first = svc.applyUpdate();          // starts, awaits gate (guard held)
  const second = await svc.applyUpdate();   // should be rejected immediately
  assert.deepEqual(second, { success: false, error: 'Update already in progress' });

  release();
  await first;
});
