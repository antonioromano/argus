import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { FileWatcherService } = await import('./FileWatcherService.js');

function tmp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'argus-fswatch-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Collector that resolves once onChange has fired at least once, after a
 *  short settle so bursts coalesce. */
function makeCollector(debounceMs = 30) {
  const calls: Array<{ sessionId: string; dirs: string[] }> = [];
  const svc = new FileWatcherService((sessionId, dirs) => calls.push({ sessionId, dirs }), debounceMs);
  return { svc, calls };
}

/** Wait past the watcher's arming grace window (FSEvents replays pre-arm
 *  changes at start; the service drops the first 200ms) before mutating. */
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('reports the parent dir when a file is created in the watched root', async () => {
  const { dir, cleanup } = tmp();
  const { svc, calls } = makeCollector();
  try {
    svc.watch('s1', dir);
    await settle(300);
    writeFileSync(join(dir, 'new.md'), 'hi');
    await settle(300);
    assert.ok(calls.length >= 1, 'expected at least one change event');
    assert.ok(calls.some((c) => c.sessionId === 's1' && c.dirs.includes(dir)), 'expected root dir in reported dirs');
  } finally {
    await svc.stopAll();
    cleanup();
  }
});

test('reports the nested parent dir for a file created in a subfolder', async () => {
  const { dir, cleanup } = tmp();
  const sub = join(dir, 'sub');
  mkdirSync(sub);
  const { svc, calls } = makeCollector();
  try {
    svc.watch('s1', dir);
    await settle(300);
    writeFileSync(join(sub, 'x.ts'), 'x');
    await settle(300);
    assert.ok(calls.some((c) => c.dirs.includes(sub)), `expected ${sub} in ${JSON.stringify(calls)}`);
  } finally {
    await svc.stopAll();
    cleanup();
  }
});

test('coalesces a burst of creates into a single flush', async () => {
  const { dir, cleanup } = tmp();
  // Leading-edge debounce: the first event arms a fixed window (it does not
  // extend on later events). Under CI load the 5 fs.watch events can span more
  // than a tight 30ms window, closing it early and opening a second flush. Use
  // a generous window so the whole burst reliably lands in one flush.
  const { svc, calls } = makeCollector(200);
  try {
    svc.watch('s1', dir);
    await settle(300);
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `f${i}.txt`), String(i));
    await settle(600);
    // All five land in the same dir within one debounce window → one flush, one dir.
    assert.equal(calls.length, 1, `expected a single coalesced flush, got ${calls.length}`);
    assert.deepEqual(calls[0].dirs, [dir]);
  } finally {
    await svc.stopAll();
    cleanup();
  }
});

test('ignores writes under excluded directories (node_modules)', async () => {
  const { dir, cleanup } = tmp();
  const nm = join(dir, 'node_modules');
  mkdirSync(nm);
  const { svc, calls } = makeCollector();
  try {
    svc.watch('s1', dir);
    await settle(300);
    writeFileSync(join(nm, 'pkg.js'), 'noise');
    await settle(300);
    assert.equal(calls.length, 0, `expected no events for node_modules, got ${JSON.stringify(calls)}`);
  } finally {
    await svc.stopAll();
    cleanup();
  }
});

test('double watch is a no-op; stop/stopAll close watchers', async () => {
  const { dir, cleanup } = tmp();
  const { svc } = makeCollector();
  try {
    svc.watch('s1', dir);
    svc.watch('s1', dir); // duplicate ignored
    svc.watch('s2', dir);
    assert.equal(svc.size, 2);
    await svc.stop('s1');
    assert.equal(svc.size, 1);
    await svc.stop('unknown'); // safe no-op
    await svc.stopAll();
    assert.equal(svc.size, 0);
  } finally {
    await svc.stopAll();
    cleanup();
  }
});

test('no callbacks fire after stop', async () => {
  const { dir, cleanup } = tmp();
  const { svc, calls } = makeCollector();
  try {
    svc.watch('s1', dir);
    await settle(300);
    await svc.stop('s1');
    writeFileSync(join(dir, 'after.txt'), 'x');
    await settle(300);
    assert.equal(calls.length, 0);
  } finally {
    await svc.stopAll();
    cleanup();
  }
});
