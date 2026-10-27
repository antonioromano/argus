import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, renameSync } from 'fs';
import os from 'os';
import path from 'path';
import { TranscriptTailer, isGithubPrUrl, MAX_PR_URLS, type TranscriptFs } from './TranscriptTailer.js';

function tmpFile(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'argus-tailer-'));
  return path.join(dir, 'abc.jsonl');
}

function assistant(id: string, u: { in?: number; out?: number; read?: number; write?: number }, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'assistant',
    ...extra,
    message: {
      id,
      model: (extra.model as string) ?? 'claude-opus-5-5',
      usage: {
        input_tokens: u.in ?? 0,
        output_tokens: u.out ?? 0,
        cache_read_input_tokens: u.read ?? 0,
        cache_creation_input_tokens: u.write ?? 0,
      },
    },
  }) + '\n';
}

test('sums usage across assistant entries and ignores other lines', async () => {
  const f = tmpFile();
  writeFileSync(f,
    JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n'
    + assistant('m1', { in: 10, out: 5, read: 100, write: 50 })
    + '{not json\n'
    + assistant('m2', { in: 1, out: 2, read: 3, write: 4 }));
  const t = new TranscriptTailer(f);
  assert.equal(await t.poll(), true);
  assert.deepEqual(t.totals, { input: 11, output: 7, cacheRead: 103, cacheCreation: 54 });
  assert.equal(t.turns, 2);
  assert.deepEqual(t.context, { tokens: 1 + 3 + 4, model: 'claude-opus-5-5' });
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('dedupes streamed entries of one message by id; the last one wins', async () => {
  const f = tmpFile();
  writeFileSync(f,
    assistant('m1', { in: 10, out: 1, read: 100 })
    + assistant('m1', { in: 10, out: 40, read: 100 })
    + assistant('m1', { in: 10, out: 90, read: 100 }));
  const t = new TranscriptTailer(f);
  await t.poll();
  assert.deepEqual(t.totals, { input: 10, output: 90, cacheRead: 100, cacheCreation: 0 });
  assert.equal(t.turns, 1);
  // A later repeat in a separate poll still replaces, not adds.
  appendFileSync(f, assistant('m1', { in: 10, out: 95, read: 100 }));
  await t.poll();
  assert.equal(t.totals.output, 95);
  assert.equal(t.turns, 1);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('a line split across two writes is parsed once, after it completes', async () => {
  const f = tmpFile();
  const line = assistant('m1', { in: 7, out: 3 });
  writeFileSync(f, line.slice(0, 20));
  const t = new TranscriptTailer(f);
  assert.equal(await t.poll(), false);
  assert.equal(t.totals.input, 0);
  appendFileSync(f, line.slice(20));
  assert.equal(await t.poll(), true);
  assert.equal(t.totals.input, 7);
  assert.equal(await t.poll(), false, 'nothing new on a repeat poll');
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('a multi-byte character split across reads survives', async () => {
  const f = tmpFile();
  const line = assistant('m1', { in: 2 }, { note: 'héllo — ✓' });
  const buf = Buffer.from(line);
  const cut = buf.indexOf(Buffer.from('✓')) + 1; // inside the 3-byte sequence
  writeFileSync(f, buf.subarray(0, cut));
  const t = new TranscriptTailer(f);
  await t.poll();
  appendFileSync(f, buf.subarray(cut));
  await t.poll();
  assert.equal(t.totals.input, 2);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('reads only appended bytes', async () => {
  const f = tmpFile();
  writeFileSync(f, assistant('m1', { in: 1 }));
  const reads: number[] = [];
  const fs: TranscriptFs = {
    stat: async (p) => { const s = (await import('fs')).statSync(p); return { size: s.size, ino: s.ino }; },
    read: async (p, pos, len) => {
      reads.push(pos);
      const fd = (await import('fs')).openSync(p, 'r');
      const b = Buffer.alloc(len);
      const n = (await import('fs')).readSync(fd, b, 0, len, pos);
      (await import('fs')).closeSync(fd);
      return b.subarray(0, n);
    },
  };
  const t = new TranscriptTailer(f, fs);
  await t.poll();
  const firstLen = Buffer.byteLength(assistant('m1', { in: 1 }));
  appendFileSync(f, assistant('m2', { in: 2 }));
  await t.poll();
  assert.deepEqual(reads, [0, firstLen]);
  assert.equal(t.totals.input, 3);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('a truncated or replaced file is re-read from the start', async () => {
  const f = tmpFile();
  writeFileSync(f, assistant('m1', { in: 100 }) + assistant('m2', { in: 100 }));
  const t = new TranscriptTailer(f);
  await t.poll();
  assert.equal(t.totals.input, 200);

  writeFileSync(f, assistant('x1', { in: 5 })); // shrank
  assert.equal(await t.poll(), true);
  assert.equal(t.totals.input, 5);

  // Replaced by a new file (new inode) that happens to be larger.
  const other = f + '.new';
  writeFileSync(other, assistant('y1', { in: 1 }) + assistant('y2', { in: 1 }) + assistant('y3', { in: 1 }));
  renameSync(other, f);
  await t.poll();
  assert.equal(t.totals.input, 3);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('sidechain turns count toward the totals but not the main context', async () => {
  const f = tmpFile();
  writeFileSync(f,
    assistant('m1', { in: 1, read: 1000 })
    + assistant('s1', { in: 1, read: 50 }, { isSidechain: true }));
  const t = new TranscriptTailer(f);
  await t.poll();
  assert.equal(t.context?.tokens, 1001);
  assert.equal(t.totals.cacheRead, 1050);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('unknown models still count; synthetic messages are skipped', async () => {
  const f = tmpFile();
  writeFileSync(f,
    assistant('m1', { in: 10 }, { model: 'claude-mystery-1' })
    + assistant('m2', { in: 10 }, { model: '<synthetic>' }));
  const t = new TranscriptTailer(f);
  await t.poll();
  assert.equal(t.turns, 1);
  assert.equal(t.totals.input, 10, 'synthetic message skipped');
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('serialize/restore resumes at the offset and still dedupes the last message', async () => {
  const f = tmpFile();
  writeFileSync(f, assistant('m1', { in: 10, out: 1 }));
  const t = new TranscriptTailer(f);
  await t.poll();
  const restored = TranscriptTailer.restore(JSON.parse(JSON.stringify(t.serialize())));
  appendFileSync(f, assistant('m1', { in: 10, out: 9 }) + assistant('m2', { in: 1 }));
  await restored.poll();
  assert.deepEqual(restored.totals, { input: 11, output: 9, cacheRead: 0, cacheCreation: 0 });
  assert.equal(restored.turns, 2);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('a missing file is not an error', async () => {
  const t = new TranscriptTailer(path.join(os.tmpdir(), 'argus-no-such-dir', 'x.jsonl'));
  assert.equal(await t.poll(), false);
});

test('the model string is capped', async () => {
  const f = tmpFile();
  writeFileSync(f, assistant('m1', { in: 1 }, { model: 'claude-' + 'x'.repeat(500) }));
  const t = new TranscriptTailer(f);
  await t.poll();
  assert.equal(t.context!.model!.length, 100);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

/** Real file, but every read returns at most `max` bytes — many tiny chunks. */
function trickleFs(max: number): TranscriptFs {
  return {
    stat: async (p) => { const st = (await import('fs')).statSync(p); return { size: st.size, ino: st.ino }; },
    read: async (p, pos, len) => {
      const fsm = await import('fs');
      const n = Math.min(len, max);
      const fd = fsm.openSync(p, 'r');
      const b = Buffer.alloc(n);
      const got = fsm.readSync(fd, b, 0, n, pos);
      fsm.closeSync(fd);
      return b.subarray(0, got);
    },
  };
}

test('lines delivered in tiny chunks parse exactly once', async () => {
  const f = tmpFile();
  writeFileSync(f, assistant('m1', { in: 3 }) + assistant('m2', { in: 4 }, { note: 'ünï✓' }));
  const t = new TranscriptTailer(f, trickleFs(7));
  await t.poll();
  assert.equal(t.totals.input, 7);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('a multi-MB line in small chunks is linear, not quadratic', async () => {
  const f = tmpFile();
  writeFileSync(f, assistant('big', { in: 9 }, { blob: 'x'.repeat(4 * 1024 * 1024) }));
  const t = new TranscriptTailer(f, trickleFs(4096)); // ~1000 chunks for one line
  const t0 = performance.now();
  await t.poll();
  const ms = performance.now() - t0;
  assert.equal(t.totals.input, 9);
  // Re-concatenating per chunk copies ~2 GB here and takes seconds.
  assert.ok(ms < 1500, `took ${ms.toFixed(0)}ms`);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('restores state written before the cost estimate was removed', async () => {
  const f = tmpFile();
  writeFileSync(f, assistant('m1', { in: 10, out: 1 }));
  const legacy = {
    path: f, offset: 0, totals: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    cost: 1.5, pricedTurns: 2, unpricedTurns: 1, recent: [['x', { input: 1, output: 1, cacheRead: 0, cacheCreation: 0, cost: 0.1 }]],
  };
  const t = TranscriptTailer.restore(legacy as never);
  assert.equal(t.turns, 3);
  assert.equal('cost' in t.serialize(), false);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

const prLink = (prUrl: string): string =>
  JSON.stringify({ type: 'pr-link', sessionId: 's', prNumber: 1, prUrl, prRepository: 'o/r', timestamp: 't' }) + '\n';

test('tracks the latest pr-link without touching usage; persists it', async () => {
  const f = tmpFile();
  writeFileSync(f, assistant('m1', { in: 1 }) + prLink('https://github.com/o/r/pull/1') + prLink('https://github.com/o/s/pull/22'));
  const t = new TranscriptTailer(f);
  await t.poll();
  assert.equal(t.prUrl, 'https://github.com/o/s/pull/22');
  assert.equal(t.turns, 1);
  appendFileSync(f, prLink('https://github.com/o/r/pull/3'));
  assert.equal(await t.poll(), false, 'a pr-link is not a usage change');
  assert.equal(t.prUrl, 'https://github.com/o/r/pull/3');
  const restored = TranscriptTailer.restore(JSON.parse(JSON.stringify(t.serialize())));
  assert.equal(restored.prUrl, 'https://github.com/o/r/pull/3');
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('ignores pr-link entries whose URL is not a github.com PR', async () => {
  const f = tmpFile();
  writeFileSync(f, prLink('https://github.com/o/r/pull/1')
    + prLink('https://evil.example/o/r/pull/2')
    + prLink('https://github.com/o/r/pull/3 --repo x')
    + JSON.stringify({ type: 'user', message: { content: 'see "pr-link" https://github.com/o/r/pull/4' } }) + '\n');
  const t = new TranscriptTailer(f);
  await t.poll();
  assert.equal(t.prUrl, 'https://github.com/o/r/pull/1');
  assert.equal(TranscriptTailer.restore({ ...t.serialize(), prUrls: undefined, prUrl: 'javascript:alert(1)' }).prUrl, undefined);
  assert.deepEqual(
    TranscriptTailer.restore({ ...t.serialize(), prUrls: ['https://evil.example/o/r/pull/2', 'https://github.com/o/r/pull/5'] }).prUrls,
    ['https://github.com/o/r/pull/5'],
  );
  assert.equal(isGithubPrUrl('https://github.com/o/r/pull/new/feat'), false);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('collects every pr-link, deduped, a re-linked PR moving to the end; persists the list', async () => {
  const f = tmpFile();
  const [a, b, c] = ['https://github.com/o/r/pull/1', 'https://github.com/o/s/pull/2', 'https://github.com/o/r/pull/3'];
  writeFileSync(f, prLink(a) + prLink(b) + prLink(a) + prLink(c));
  const t = new TranscriptTailer(f);
  await t.poll();
  assert.deepEqual(t.prUrls, [b, a, c]);
  assert.equal(t.prUrl, c);
  const state = JSON.parse(JSON.stringify(t.serialize()));
  assert.deepEqual(state.prUrls, [b, a, c]);
  assert.equal(state.prUrl, c, 'the single-PR field is still written for older builds');
  assert.deepEqual(TranscriptTailer.restore(state).prUrls, [b, a, c]);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('restores state written before the PR list (prUrl only)', () => {
  const t = new TranscriptTailer('/x.jsonl');
  const legacy = { ...t.serialize(), prUrls: undefined, prUrl: 'https://github.com/o/r/pull/9' };
  delete (legacy as { prUrls?: unknown }).prUrls;
  assert.deepEqual(TranscriptTailer.restore(legacy).prUrls, ['https://github.com/o/r/pull/9']);
  assert.equal('prUrls' in t.serialize() && t.serialize().prUrls !== undefined, false, 'no list written when empty');
});

test('keeps only the newest MAX_PR_URLS links', async () => {
  const f = tmpFile();
  let body = '';
  for (let i = 1; i <= MAX_PR_URLS + 5; i++) body += prLink(`https://github.com/o/r/pull/${i}`);
  writeFileSync(f, body);
  const t = new TranscriptTailer(f);
  await t.poll();
  assert.equal(t.prUrls.length, MAX_PR_URLS);
  assert.equal(t.prUrls[0], 'https://github.com/o/r/pull/6');
  assert.equal(t.prUrl, `https://github.com/o/r/pull/${MAX_PR_URLS + 5}`);
  rmSync(path.dirname(f), { recursive: true, force: true });
});

test('an assistant entry that merely mentions "pr-link" still counts its usage', async () => {
  const f = tmpFile();
  const grep = JSON.stringify({
    type: 'assistant',
    message: {
      id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'pr-link' } }],
    },
  }) + '\n';
  writeFileSync(f, grep);
  const t = new TranscriptTailer(f);
  assert.equal(await t.poll(), true);
  assert.equal(t.turns, 1);
  assert.deepEqual(t.totals, { input: 10, output: 5, cacheRead: 0, cacheCreation: 0 });
  assert.equal(t.prUrl, undefined);
  rmSync(path.dirname(f), { recursive: true, force: true });
});
