import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { nodeTranscriptFs, type TranscriptFs } from './JsonlTailer.js';
import { AGENT_ROSTER_CAP, AGENT_VERSION_PROBE_BYTES, AgentRoster, isAgentId } from './AgentRoster.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'subagents');
const NAMED_FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'subagents-named');
const NAMED = 'ap2-palette-fe28114a195e07d2';
const ID = 'aaaaaaaaaaaaaaaaa';
/** The fixture jsonl's first and last entry timestamps (entries are 1 s apart). */
const T0 = Date.parse('2026-11-09T14:36:24.000Z');
const LAST = T0 + 3000;
const MIN = 60_000;

function folder(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'argus-roster-'));
  cpSync(FIXTURES, dir, { recursive: true });
  return dir;
}
const metaPath = (dir: string, id = ID) => path.join(dir, `agent-${id}.meta.json`);
const jsonlPath = (dir: string, id = ID) => path.join(dir, `agent-${id}.jsonl`);
const fixtureMeta = (): Record<string, unknown> => JSON.parse(readFileSync(path.join(FIXTURES, `agent-${ID}.meta.json`), 'utf8'));
function writeMeta(dir: string, id: string, patch: Record<string, unknown>): void {
  writeFileSync(metaPath(dir, id), JSON.stringify({ ...fixtureMeta(), ...patch }));
}
/** The fixture jsonl with its entries re-timed to start at `start`. */
function jsonlFrom(start: number, version = '2.1.319'): string {
  return readFileSync(path.join(FIXTURES, `agent-${ID}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l, i) => JSON.stringify({ ...JSON.parse(l), timestamp: new Date(start + i * 1000).toISOString(), version }) + '\n')
    .join('');
}

/** nodeTranscriptFs that counts `read` calls per path. */
function countingFs(): { fs: TranscriptFs; reads: Map<string, number> } {
  const reads = new Map<string, number>();
  const fs: TranscriptFs = {
    ...nodeTranscriptFs,
    read(p, pos, len) {
      reads.set(p, (reads.get(p) ?? 0) + 1);
      return nodeTranscriptFs.read(p, pos, len);
    },
  };
  return { fs, reads };
}

describe('AgentRoster', () => {
  test('lists a running agent from its meta and tails its jsonl', async () => {
    const dir = folder();
    const r = new AgentRoster(dir, { now: () => LAST + 1000 });
    assert.equal(await r.poll(), true);
    const [a] = r.agents();
    assert.deepEqual(a, {
      id: ID,
      toolUseId: 'toolu_1',
      agentType: 'pre-push-reviewer',
      description: 'Delta review of fix commit',
      background: true,
      depth: 1,
      startedAt: T0,
      status: 'running',
      outputTokens: 416,
      lastStep: { name: 'Bash', label: 'Run tests', status: 'ok' },
    });
    assert.equal(r.runningCount(), 1);
    assert.equal(await r.poll(), false);
    r.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  test('an agent already finished at first sight is listed from meta only', async () => {
    const dir = folder();
    writeMeta(dir, ID, { finished: true });
    const { fs, reads } = countingFs();
    const r = new AgentRoster(dir, { fs, now: () => LAST });
    await r.poll();
    await r.poll();
    const [a] = r.agents();
    assert.equal(a.status, 'finished');
    assert.equal(a.outputTokens, 0);
    assert.equal(a.lastStep, undefined);
    assert.equal(reads.get(jsonlPath(dir)) ?? 0, 0);
    assert.equal(r.runningCount(), 0);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a pre-2.1.301 agent without the flag is never running', async () => {
    const dir = folder();
    writeFileSync(jsonlPath(dir), jsonlFrom(T0, '2.1.299'));
    const r = new AgentRoster(dir, { now: () => LAST });
    await r.poll();
    assert.equal(r.agents()[0].status, 'finished');
    assert.equal(r.runningCount(), 0);
    rmSync(dir, { recursive: true, force: true });
  });

  test('an agent whose first line is larger than the version probe still runs', async () => {
    const dir = folder();
    // A long prompt: the first entry alone is past the 64 KB head the probe reads.
    const lines = jsonlFrom(T0).split('\n').filter(Boolean);
    const first = JSON.parse(lines[0]);
    first.message = { role: 'user', content: 'x'.repeat(200 * 1024) };
    writeFileSync(jsonlPath(dir), [JSON.stringify(first), ...lines.slice(1)].join('\n') + '\n');
    const r = new AgentRoster(dir, { now: () => LAST });
    await r.poll();
    assert.equal(r.agents()[0].status, 'running');
    assert.equal(r.runningCount(), 1);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a pre-2.1.301 agent with a huge first line is still never running', async () => {
    const dir = folder();
    const lines = jsonlFrom(T0, '2.1.299').split('\n').filter(Boolean);
    const first = JSON.parse(lines[0]);
    first.message = { role: 'user', content: 'x'.repeat(200 * 1024) };
    writeFileSync(jsonlPath(dir), [JSON.stringify(first), ...lines.slice(1)].join('\n') + '\n');
    const r = new AgentRoster(dir, { now: () => LAST });
    await r.poll();
    assert.equal(r.agents()[0].status, 'finished');
    rmSync(dir, { recursive: true, force: true });
  });

  test('finished flips when the meta gains the flag', async () => {
    const dir = folder();
    const r = new AgentRoster(dir, { now: () => LAST });
    await r.poll();
    assert.equal(r.agents()[0].status, 'running');
    writeMeta(dir, ID, { finished: true });
    assert.equal(await r.poll(), true);
    const [a] = r.agents();
    assert.equal(a.status, 'finished');
    assert.equal(a.finishedAt, LAST);
    assert.equal(a.outputTokens, 416);
    assert.equal(r.runningCount(), 0);
    rmSync(dir, { recursive: true, force: true });
  });

  test('finished within the same mtime', async () => {
    const dir = folder();
    const fs: TranscriptFs = {
      ...nodeTranscriptFs,
      async stat(p) {
        const s = await nodeTranscriptFs.stat(p);
        return { ...s, mtimeMs: 1 };
      },
    };
    const r = new AgentRoster(dir, { fs, now: () => LAST });
    await r.poll();
    assert.equal(r.agents()[0].status, 'running');
    writeMeta(dir, ID, { finished: true });
    assert.equal(await r.poll(), true);
    assert.equal(r.agents()[0].status, 'finished');
    rmSync(dir, { recursive: true, force: true });
  });

  test('malformed meta is skipped', async () => {
    const dir = folder();
    writeFileSync(metaPath(dir), '{');
    const r = new AgentRoster(dir, { now: () => LAST });
    await r.poll();
    assert.deepEqual(r.agents(), []);
    writeMeta(dir, ID, {});
    assert.equal(await r.poll(), true);
    assert.equal(r.agents()[0]?.id, ID);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a task notification ends an agent', async () => {
    const dir = folder();
    const done = new AgentRoster(dir, { now: () => LAST });
    await done.poll();
    assert.equal(done.applyNotification({ taskId: ID, status: 'completed', at: LAST + 500 }), true);
    assert.equal(done.agents()[0].status, 'finished');
    assert.equal(done.runningCount(), 0);
    assert.equal(done.applyNotification({ taskId: ID, status: 'completed', at: LAST + 900 }), false);

    const failed = new AgentRoster(dir, { now: () => LAST });
    await failed.poll();
    assert.equal(failed.applyNotification({ taskId: ID, status: 'failed', at: LAST + 500 }), true);
    assert.equal(failed.agents()[0].status, 'failed');

    const unknown = new AgentRoster(dir, { now: () => LAST });
    await unknown.poll();
    assert.equal(unknown.applyNotification({ taskId: 'zzzzzzzzzzzzzzzzz', status: 'completed', at: LAST }), false);
    assert.equal(unknown.agents()[0].status, 'running');
    rmSync(dir, { recursive: true, force: true });
  });

  test('failAll marks running agents failed', async () => {
    const dir = folder();
    writeMeta(dir, 'bbbbbbbbbbbbbbbbb', { finished: true });
    const r = new AgentRoster(dir, { now: () => LAST });
    await r.poll();
    assert.equal(r.runningCount(), 1);
    assert.equal(r.failAll(), true);
    const byId = new Map(r.agents().map((a) => [a.id, a]));
    assert.equal(byId.get(ID)?.status, 'failed');
    assert.equal(byId.get('bbbbbbbbbbbbbbbbb')?.status, 'finished');
    assert.equal(r.runningCount(), 0);
    assert.equal(r.failAll(), false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('quiet rows say so', async () => {
    const dir = folder();
    let now = LAST + 6 * MIN;
    const r = new AgentRoster(dir, { now: () => now });
    await r.poll();
    assert.equal(r.agents()[0].quietMinutes, 6);
    now += 1000;
    const line = JSON.parse(jsonlFrom(T0).split('\n')[1]);
    appendFileSync(jsonlPath(dir), JSON.stringify({ ...line, timestamp: new Date(now).toISOString() }) + '\n');
    assert.equal(await r.poll(), true);
    assert.equal(r.agents()[0].quietMinutes, undefined);
    assert.equal(r.agents()[0].status, 'running');
    rmSync(dir, { recursive: true, force: true });
  });

  test('cap and order', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'argus-roster-'));
    const idOf = (i: number) => `agent${String(i).padStart(2, '0')}x`;
    for (let i = 0; i < 25; i++) {
      const id = idOf(i);
      const start = T0 + i * MIN;
      if (i % 8 === 1) {
        // 3 running: i = 1, 9, 17
        writeMeta(dir, id, {});
        writeFileSync(jsonlPath(dir, id), jsonlFrom(start));
      } else {
        writeMeta(dir, id, { finished: true });
        utimesSync(metaPath(dir, id), new Date(start), new Date(start));
      }
    }
    const r = new AgentRoster(dir, { now: () => T0 + 25 * MIN });
    await r.poll();
    const list = r.agents();
    assert.equal(list.length, AGENT_ROSTER_CAP);
    assert.equal(r.runningCount(), 3);
    assert.deepEqual(list.slice(0, 3).map((a) => a.id), [idOf(17), idOf(9), idOf(1)]);
    assert.ok(list.slice(0, 3).every((a) => a.status === 'running'));
    const finished = list.slice(3);
    assert.ok(finished.every((a) => a.status === 'finished'));
    const expected = [...Array(25).keys()].filter((i) => i % 8 !== 1).reverse().slice(0, 17).map(idOf);
    assert.deepEqual(finished.map((a) => a.id), expected);
    rmSync(dir, { recursive: true, force: true });
  });

  test('nested agents carry parentAgentId', async () => {
    const dir = folder();
    writeMeta(dir, 'bbbbbbbbbbbbbbbbb', { spawnDepth: 2, parentAgentId: ID, finished: true });
    const r = new AgentRoster(dir, { now: () => LAST });
    await r.poll();
    const nested = r.agents().find((a) => a.id === 'bbbbbbbbbbbbbbbbb');
    assert.equal(nested?.depth, 2);
    assert.equal(nested?.parentAgentId, ID);
    assert.equal(r.agents().find((a) => a.id === ID)?.parentAgentId, undefined);
    rmSync(dir, { recursive: true, force: true });
  });
  test('an unreadable agent jsonl does not stop the poll', async () => {
    const dir = folder();
    const other = 'bbbbbbbbbbbbbbbbb';
    writeMeta(dir, other, {});
    writeFileSync(jsonlPath(dir, other), jsonlFrom(T0));
    const fs: TranscriptFs = {
      ...nodeTranscriptFs,
      read(p, pos, len) {
        if (p === jsonlPath(dir)) return Promise.reject(Object.assign(new Error('EMFILE'), { code: 'EMFILE' }));
        return nodeTranscriptFs.read(p, pos, len);
      },
    };
    const r = new AgentRoster(dir, { fs, now: () => LAST });
    assert.equal(await r.poll(), true);
    assert.equal(r.agents().find((a) => a.id === other)?.outputTokens, 416);
    const line = JSON.parse(jsonlFrom(T0).split('\n')[2]);
    appendFileSync(jsonlPath(dir, other), JSON.stringify({ ...line, message: { ...line.message, id: 'msg_3' } }) + '\n');
    assert.equal(await r.poll(), true);
    assert.equal(r.agents().find((a) => a.id === other)?.outputTokens, 665);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a named agent (hyphenated id) is listed, tailed and ended by its notification', async () => {
    assert.equal(isAgentId(NAMED), true);
    for (const bad of ['a.b', '../x', 'a/b', '-abcdef', 'short', 'x'.repeat(97)]) assert.equal(isAgentId(bad), false, bad);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'argus-roster-'));
    cpSync(NAMED_FIXTURES, dir, { recursive: true });
    const r = new AgentRoster(dir, { now: () => LAST });
    await r.poll();
    const [a] = r.agents();
    assert.equal(a.id, NAMED);
    assert.equal(a.status, 'running', 'named agents never get `finished`');
    assert.equal(a.outputTokens, 416);
    assert.equal(r.applyNotification({ taskId: NAMED, toolUseId: 'toolu_named', status: 'killed', at: LAST + 500 }), true);
    assert.equal(r.agents()[0].status, 'failed');
    assert.equal(r.runningCount(), 0);
    rmSync(dir, { recursive: true, force: true });
  });

  test('run-start rule: an unfinished agent last written before the run started is failed at first sight', async () => {
    const dir = folder();
    const r = new AgentRoster(dir, { now: () => LAST + MIN, runStartedAt: LAST + 1 });
    await r.poll();
    assert.equal(r.agents()[0].status, 'failed');
    assert.equal(r.agents()[0].finishedAt, LAST);
    assert.equal(r.runningCount(), 0);

    // Written after the run started: this run's agent, running.
    const live = new AgentRoster(dir, { now: () => LAST, runStartedAt: T0 - 1 });
    await live.poll();
    assert.equal(live.agents()[0].status, 'running');
    // A later run start never fails an agent already listed (failAll does that).
    live.setRunStartedAt(LAST + MIN);
    await live.poll();
    assert.equal(live.agents()[0].status, 'running');
    rmSync(dir, { recursive: true, force: true });
  });

  test('run-start rule falls back to the jsonl mtime when no entry has a timestamp', async () => {
    const dir = folder();
    const lines = jsonlFrom(T0).split('\n').filter(Boolean).map((l) => { const e = JSON.parse(l); delete e.timestamp; return JSON.stringify(e); });
    writeFileSync(jsonlPath(dir), lines.join('\n') + '\n');
    utimesSync(jsonlPath(dir), new Date(T0), new Date(T0));
    const r = new AgentRoster(dir, { now: () => LAST, runStartedAt: T0 + 1000 });
    await r.poll();
    assert.equal(r.agents()[0].status, 'failed');
    rmSync(dir, { recursive: true, force: true });
  });

  test('after failAll, an agent first seen later and last written before it is failed too', async () => {
    const dir = folder();
    const r = new AgentRoster(dir, { now: () => LAST + MIN });
    await r.poll();
    r.failAll();
    const other = 'bbbbbbbbbbbbbbbbb';
    writeMeta(dir, other, {});
    writeFileSync(jsonlPath(dir, other), jsonlFrom(T0 + 10_000));
    await r.poll();
    assert.equal(r.agents().find((a) => a.id === other)?.status, 'failed');
    rmSync(dir, { recursive: true, force: true });
  });

  test('a notification read before the agent is first listed ends it at first sight', async () => {
    const dir = folder();
    const r = new AgentRoster(dir, { now: () => LAST });
    assert.equal(r.applyNotification({ taskId: 'zzzzzzzz', toolUseId: 'toolu_1', status: 'killed', at: LAST + 1 }), false);
    await r.poll();
    assert.equal(r.agents()[0].status, 'failed', 'matched by tool use id');
    assert.equal(r.runningCount(), 0);
    rmSync(dir, { recursive: true, force: true });
  });

  test('an older writer is decided from the first 64 KB and never tailed past it', async () => {
    const dir = folder();
    const head = jsonlFrom(T0, '2.1.200');
    const filler = JSON.stringify({ type: 'user', message: { role: 'user', content: 'x'.repeat(4096) } }) + '\n';
    writeFileSync(jsonlPath(dir), head + filler.repeat(64)); // ~260 KB
    const { fs } = countingFs();
    let bytes = 0;
    const counted: TranscriptFs = { ...fs, read: (p, pos, len) => { if (p === jsonlPath(dir)) bytes += len; return fs.read(p, pos, len); } };
    const r = new AgentRoster(dir, { fs: counted, now: () => LAST });
    await r.poll();
    await r.poll();
    assert.equal(r.agents()[0].status, 'finished');
    assert.ok(bytes <= AGENT_VERSION_PROBE_BYTES, `read ${bytes} bytes`);

    // No version at all in the head: an older writer too.
    const dir2 = folder();
    writeFileSync(jsonlPath(dir2), filler.repeat(64));
    const r2 = new AgentRoster(dir2, { now: () => LAST });
    await r2.poll();
    assert.equal(r2.agents()[0].status, 'finished');
    assert.equal(r2.runningCount(), 0);
    rmSync(dir, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  });

  test('a stuck read is warned about once per agent per minute', async () => {
    const dir = folder();
    let now = LAST;
    const fs: TranscriptFs = {
      ...nodeTranscriptFs,
      read: () => Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' })),
    };
    const warn = console.warn;
    const warned: unknown[][] = [];
    console.warn = (...args: unknown[]) => { warned.push(args); };
    try {
      const r = new AgentRoster(dir, { fs, now: () => now });
      await r.poll();
      await r.poll();
      assert.equal(warned.length, 1);
      now += MIN;
      await r.poll();
      assert.equal(warned.length, 2);
    } finally {
      console.warn = warn;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

