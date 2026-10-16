import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, symlinkSync, realpathSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  CodexRolloutTailer,
  assignRollouts,
  confineRollout,
  parseCodexRateLimits,
  parseRolloutMeta,
  scanCodexRollouts,
  type RolloutCandidate,
} from './codexRollout.js';

// Shapes copied from a real Codex 0.142 rollout file.
const meta = (cwd: string, iso: string) =>
  JSON.stringify({
    timestamp: iso,
    type: 'session_meta',
    payload: { session_id: 'x', id: 'x', timestamp: iso, cwd, originator: 'codex-tui', cli_version: '0.142.0', base_instructions: { text: 'You are Codex…' } },
  }) + '\n';
const turnContext = (model: string) =>
  JSON.stringify({ timestamp: '2026-08-21T07:30:02.015Z', type: 'turn_context', payload: { cwd: '/repo', model } }) + '\n';
const tokenCount = (o: { total?: number; last?: number; window?: number; used?: number; resetsAt?: number; info?: null }) =>
  JSON.stringify({
    timestamp: '2026-08-21T07:33:02.734Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: o.info === null ? null : {
        total_token_usage: { input_tokens: 397_077, cached_input_tokens: 349_440, output_tokens: 7_035, reasoning_output_tokens: 700, total_tokens: o.total ?? 404_112 },
        last_token_usage: { input_tokens: 32_272, cached_input_tokens: 31_104, output_tokens: 14, reasoning_output_tokens: 0, total_tokens: o.last ?? 32_286 },
        model_context_window: o.window ?? 258_400,
      },
      rate_limits: {
        limit_id: 'codex', limit_name: null,
        primary: { used_percent: o.used ?? 23.0, window_minutes: 43_200, resets_at: o.resetsAt ?? 1_789_889_270 },
        secondary: null,
        credits: { has_credits: false, unlimited: false, balance: null },
        plan_type: 'free',
      },
    },
  }) + '\n';

function tmp(): string {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), 'argus-codex-')));
}

test('token_count → context % and token totals; turn_context → model', async () => {
  const d = tmp();
  const f = path.join(d, 'rollout-a.jsonl');
  writeFileSync(f, meta('/repo', '2026-08-21T07:29:59.404Z') + turnContext('gpt-5.5') + '{torn\n' + tokenCount({}));
  const t = new CodexRolloutTailer(f);
  assert.equal(await t.poll(), true);
  const u = t.snapshot(42)!;
  assert.equal(u.model, 'gpt-5.5');
  assert.equal(u.contextTokens, 32_286);
  assert.equal(u.contextWindow, 258_400);
  assert.equal(u.contextPct, 12.5);
  assert.equal(u.cacheReadTokens, 349_440);
  assert.equal(u.inputTokens, 397_077 - 349_440, 'cached input is not double counted');
  assert.equal(u.outputTokens, 7_035);
  assert.equal(u.totalTokens, 404_112);
  assert.equal(u.updatedAt, 42);
  rmSync(d, { recursive: true, force: true });
});

test('token_count → plan usage (newest reading), consumed once', async () => {
  const d = tmp();
  const f = path.join(d, 'rollout-a.jsonl');
  writeFileSync(f, tokenCount({ used: 7 }));
  const t = new CodexRolloutTailer(f);
  await t.poll();
  assert.equal(t.takePlan()!.primary!.usedPct, 7);
  assert.equal(t.takePlan(), undefined);
  appendFileSync(f, tokenCount({ used: 23, info: null }));
  assert.equal(await t.poll(), true, 'rate limits alone are a change');
  const plan = t.takePlan()!;
  assert.deepEqual(plan.primary, { usedPct: 23, windowMinutes: 43_200, resetsAt: 1_789_889_270_000 });
  assert.equal(plan.secondary, undefined);
  assert.equal(plan.observedAt, Date.parse('2026-08-21T07:33:02.734Z'));
  rmSync(d, { recursive: true, force: true });
});

test('parseCodexRateLimits: both windows, relative resets, junk', () => {
  const p = parseCodexRateLimits({
    primary: { used_percent: 12.34, window_minutes: 300, resets_in_seconds: 60 },
    secondary: { used_percent: 50, window_minutes: 10_080, resets_at: 1_800_000_000 },
  }, 1_000_000)!;
  assert.deepEqual(p.primary, { usedPct: 12.3, windowMinutes: 300, resetsAt: 1_060_000 });
  assert.deepEqual(p.secondary, { usedPct: 50, windowMinutes: 10_080, resetsAt: 1_800_000_000_000 });
  assert.equal(parseCodexRateLimits({ primary: null, secondary: null }, 0), null);
  assert.equal(parseCodexRateLimits({ primary: { used_percent: 'x' } }, 0), null);
  assert.equal(parseCodexRateLimits('nope', 0), null);
});

test('parseRolloutMeta reads cwd + start, even from a truncated first line', () => {
  const line = meta('/Users/me/my "repo"', '2026-08-21T07:29:59.404Z');
  assert.deepEqual(parseRolloutMeta(line), { cwd: '/Users/me/my "repo"', startedAt: Date.parse('2026-08-21T07:29:59.404Z') });
  assert.deepEqual(parseRolloutMeta(line.slice(0, 200)), { cwd: '/Users/me/my "repo"', startedAt: Date.parse('2026-08-21T07:29:59.404Z') });
  assert.equal(parseRolloutMeta(turnContext('m')), undefined);
  assert.equal(parseRolloutMeta('garbage'), undefined);
});

test('assignRollouts: same cwd, started after spawn, unclaimed; latest shell picks first', () => {
  const T = 1_800_000_000_000;
  const c = (p: string, cwd: string, startedAt: number): RolloutCandidate => ({ path: p, cwd, startedAt });
  const candidates = [c('/s/old', '/repo', T - 600_000), c('/s/a', '/repo', T + 1_000), c('/s/b', '/repo', T + 60_000), c('/s/other', '/elsewhere', T + 1_000)];
  const picks = assignRollouts(
    [{ id: 'A', cwd: '/repo', spawnedAt: T }, { id: 'B', cwd: '/repo', spawnedAt: T + 59_000 }],
    candidates,
    new Set(),
  );
  assert.equal(picks.get('A'), '/s/a');
  assert.equal(picks.get('B'), '/s/b');
  // B's file is the only one after B spawned — A must not take it while A's own is missing.
  const onlyB = assignRollouts(
    [{ id: 'A', cwd: '/repo', spawnedAt: T }, { id: 'B', cwd: '/repo', spawnedAt: T + 59_000 }],
    [c('/s/b', '/repo', T + 60_000)],
    new Set(),
  );
  assert.deepEqual([...onlyB], [['B', '/s/b']]);
  assert.equal(assignRollouts([{ id: 'A', cwd: '/repo', spawnedAt: T }], candidates, new Set(['/s/a', '/s/b'])).size, 0);
});

test('scanCodexRollouts finds new rollouts under the day folders, confined to the root', async () => {
  const root = tmp();
  const now = Date.now();
  const d = new Date(now);
  const day = path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
  mkdirSync(day, { recursive: true });
  const repo = tmp();
  const iso = new Date(now).toISOString();
  writeFileSync(path.join(day, 'rollout-new.jsonl'), meta(repo, iso) + tokenCount({}));
  writeFileSync(path.join(day, 'rollout-old.jsonl'), meta(repo, new Date(now - 3_600_000).toISOString()));
  writeFileSync(path.join(day, 'notes.jsonl'), meta(repo, iso));
  // A symlink pointing out of the root is never read.
  const outside = tmp();
  writeFileSync(path.join(outside, 'rollout-x.jsonl'), meta(repo, iso));
  symlinkSync(path.join(outside, 'rollout-x.jsonl'), path.join(day, 'rollout-escape.jsonl'));

  const seen = new Map();
  const found = await scanCodexRollouts(root, now - 1_000, seen, now);
  assert.deepEqual(found.map((c) => path.basename(c.path)), ['rollout-new.jsonl']);
  assert.equal(found[0]!.cwd, repo);
  assert.equal(confineRollout(path.join(day, 'rollout-escape.jsonl'), root), undefined);
  // Cached: a second scan gives the same answer without re-reading heads.
  assert.equal((await scanCodexRollouts(root, now - 1_000, seen, now)).length, 1);
  for (const p of [root, repo, outside]) rmSync(p, { recursive: true, force: true });
});
