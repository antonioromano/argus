import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import type { SessionUsage } from '@argus/shared';
import { SessionUsageTracker, isPlausibleTranscriptPath } from './SessionUsageTracker.js';

function line(id: string, input: number, output = 0, model = 'claude-opus-5-5'): string {
  return JSON.stringify({
    type: 'assistant',
    message: { id, model, usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  }) + '\n';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function dir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'argus-usage-'));
}

test('isPlausibleTranscriptPath accepts absolute normalized .jsonl paths only', () => {
  assert.equal(isPlausibleTranscriptPath('/Users/a/.claude/projects/-x/1f2e.jsonl'), true);
  assert.equal(isPlausibleTranscriptPath('relative/x.jsonl'), false);
  assert.equal(isPlausibleTranscriptPath('/a/../etc/x.jsonl'), false);
  assert.equal(isPlausibleTranscriptPath('/etc/passwd'), false);
  assert.equal(isPlausibleTranscriptPath('/a/x.jsonl\0'), false);
  assert.equal(isPlausibleTranscriptPath(42), false);
});

test('aggregates across transcripts; context comes from the current one', async () => {
  const d = dir();
  const a = path.join(d, 'a.jsonl');
  const b = path.join(d, 'b.jsonl');
  writeFileSync(a, line('a1', 100, 10));
  writeFileSync(b, line('b1', 5, 1));
  const t = new SessionUsageTracker(() => {}, { debounceMs: 1, emitThrottleMs: 0 });
  t.setTranscript(a);
  await t.pollNow();
  t.setTranscript(b); // e.g. /clear
  await t.pollNow();
  const u = t.snapshot()!;
  assert.equal(u.inputTokens, 105);
  assert.equal(u.outputTokens, 11);
  assert.equal(u.totalTokens, 116);
  assert.equal(u.contextTokens, 5);
  assert.equal(u.contextWindow, 1_000_000);
  assert.equal(u.model, 'claude-opus-5-5');
  assert.ok(u.costUsd !== undefined && u.costUsd > 0);
  assert.equal(u.costPartial, undefined);

  // Back to the first transcript (resume): it continues, nothing double counts.
  appendFileSync(a, line('a2', 1));
  t.setTranscript(a);
  await t.pollNow();
  assert.equal(t.snapshot()!.inputTokens, 106);
  t.dispose();
  rmSync(d, { recursive: true, force: true });
});

test('unpriced turns are marked partial; all-unpriced has no cost', async () => {
  const d = dir();
  const a = path.join(d, 'a.jsonl');
  writeFileSync(a, line('a1', 10, 0, 'claude-mystery'));
  const t = new SessionUsageTracker(() => {}, { emitThrottleMs: 0 });
  t.setTranscript(a);
  await t.pollNow();
  let u = t.snapshot()!;
  assert.equal(u.costUsd, undefined);
  assert.equal(u.contextPct, undefined, 'unknown window → no percentage');
  appendFileSync(a, line('a2', 10));
  await t.pollNow();
  u = t.snapshot()!;
  assert.ok(u.costUsd !== undefined);
  assert.equal(u.costPartial, true);
  t.dispose();
  rmSync(d, { recursive: true, force: true });
});

test('debounces bursts of schedule() into one read and throttles change events', async () => {
  const d = dir();
  const a = path.join(d, 'a.jsonl');
  writeFileSync(a, line('a1', 1));
  const events: SessionUsage[] = [];
  const t = new SessionUsageTracker((u) => events.push(u), { debounceMs: 20, emitThrottleMs: 200 });
  t.setTranscript(a);
  for (let i = 0; i < 10; i++) t.schedule();
  await sleep(60);
  assert.equal(events.length, 1, 'leading-edge emit');
  appendFileSync(a, line('a2', 1));
  t.schedule();
  await sleep(60);
  assert.equal(events.length, 1, 'second change held by the throttle');
  await sleep(200);
  assert.equal(events.length, 2, 'trailing emit');
  assert.equal(events[1]!.inputTokens, 2);
  t.dispose();
  rmSync(d, { recursive: true, force: true });
});

test('serialize/restore keeps totals without re-reading; clearCurrent drops context', async () => {
  const d = dir();
  const a = path.join(d, 'a.jsonl');
  writeFileSync(a, line('a1', 50));
  const t = new SessionUsageTracker(() => {}, { emitThrottleMs: 0 });
  t.setTranscript(a);
  await t.pollNow();
  const r = SessionUsageTracker.restore(JSON.parse(JSON.stringify(t.serialize())), () => {}, { emitThrottleMs: 0 });
  assert.equal(r.snapshot()!.inputTokens, 50);
  assert.equal(r.snapshot()!.contextTokens, 50);
  r.clearCurrent();
  assert.equal(r.snapshot()!.contextTokens, undefined);
  assert.equal(r.snapshot()!.inputTokens, 50, 'totals survive a fresh restart');
  t.dispose();
  r.dispose();
  rmSync(d, { recursive: true, force: true });
});

test('setTranscript ignores implausible paths', () => {
  const t = new SessionUsageTracker(() => {});
  t.setTranscript('/etc/passwd');
  assert.equal(t.serialize().transcripts.length, 0);
  t.dispose();
});

test('history copied into a second transcript (fork / resume) is not counted twice', async () => {
  const d = dir();
  const a = path.join(d, 'a.jsonl');
  const b = path.join(d, 'b.jsonl');
  writeFileSync(a, line('m1', 100) + line('m2', 50));
  const t = new SessionUsageTracker(() => {}, { emitThrottleMs: 0 });
  t.setTranscript(a);
  await t.pollNow();
  writeFileSync(b, line('m1', 100) + line('m2', 50) + line('m3', 7)); // copied history + one new turn
  t.setTranscript(b);
  await t.pollNow();
  assert.equal(t.snapshot()!.inputTokens, 157);
  t.dispose();
  rmSync(d, { recursive: true, force: true });
});
