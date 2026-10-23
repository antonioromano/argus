import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, realpath } from 'fs/promises';
import { tmpdir } from 'os';
import path, { join } from 'path';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { SessionManager } from '../services/SessionManager.js';
import { createFilesystemRoutes } from './filesystem.js';
import { getRipgrepPath } from '../utils/ripgrep.js';

// Integration test for GET /fs/find against a real temp tree and the real rg.
// The SessionManager is faked to resolveWithinAnySession, scoped to the tree.

let dir: string;
let server: Server;
let base: string;
const rg = getRipgrepPath();

before(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'argus-find-test-')));
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'a.ts'), 'const Needle = 1;\nconst needles = 2;\n// needle again\n');
  await writeFile(join(dir, 'src', 'b.tsx'), 'export const x = "needle";\n');
  await writeFile(join(dir, 'notes.md'), 'a needle in markdown\n');
  await writeFile(join(dir, 'bundle.js.map'), 'needle\n');
  await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(join(dir, 'node_modules', 'pkg', 'index.ts'), 'needle\n');

  const fakeSm = {
    resolveWithinAnySession(rawPath: string): string | null {
      const resolved = path.resolve(rawPath);
      return resolved === dir || resolved.startsWith(dir + path.sep) ? resolved : null;
    },
  } as unknown as SessionManager;

  const app = express();
  app.use('/fs', createFilesystemRoutes(fakeSm));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/fs`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

async function find(params: Record<string, string>) {
  const qs = new URLSearchParams({ path: dir, ...params }).toString();
  const res = await fetch(`${base}/find?${qs}`);
  return { status: res.status, body: await res.json() as any };
}

const rel = (p: string) => path.relative(dir, p);

test('find groups case-insensitive literal matches by file and skips exclusions', { skip: !rg }, async () => {
  const { status, body } = await find({ q: 'needle' });
  assert.equal(status, 200);
  const files = body.files.map((f: any) => rel(f.path)).sort();
  assert.deepEqual(files, ['notes.md', 'src/a.ts', 'src/b.tsx']);
  const a = body.files.find((f: any) => rel(f.path) === 'src/a.ts');
  assert.deepEqual(a.matches.map((m: any) => m.line), [1, 2, 3]);
  const first = a.matches[0];
  assert.equal(first.preview.slice(first.ranges[0][0], first.ranges[0][1]), 'Needle');
  assert.equal(body.totalMatches, 5);
  assert.equal(body.truncated, false);
});

test('find honours case sensitivity and whole word', { skip: !rg }, async () => {
  const { body } = await find({ q: 'needle', case: '1', word: '1' });
  const lines = body.files.flatMap((f: any) => f.matches.map((m: any) => `${rel(f.path)}:${m.line}`)).sort();
  assert.deepEqual(lines, ['notes.md:1', 'src/a.ts:3', 'src/b.tsx:1']);
});

test('find supports regex and include/exclude globs', { skip: !rg }, async () => {
  const { body } = await find({ q: 'need(le|les)', regex: '1', include: 'src/**', exclude: '*.tsx' });
  assert.deepEqual(body.files.map((f: any) => rel(f.path)), ['src/a.ts']);
});

test('an include glob cannot re-open an excluded tree', { skip: !rg }, async () => {
  const { body } = await find({ q: 'needle', include: 'node_modules/**' });
  assert.deepEqual(body.files, []);
});

test('find treats a dash-prefixed query as a pattern, not a flag', { skip: !rg }, async () => {
  const { status, body } = await find({ q: '--files' });
  assert.equal(status, 200);
  assert.deepEqual(body.files, []);
});

test('find reports an invalid regex as 400', { skip: !rg }, async () => {
  const { status, body } = await find({ q: 'fo(o', regex: '1' });
  assert.equal(status, 400);
  assert.match(body.error, /regex/);
});

test('find rejects a path outside every session', async () => {
  const qs = new URLSearchParams({ path: '/etc', q: 'root' }).toString();
  const res = await fetch(`${base}/find?${qs}`);
  assert.equal(res.status, 403);
});

test('find validates the query and globs', async () => {
  assert.equal((await find({ q: '' })).status, 400);
  assert.equal((await find({ q: 'a\nb' })).status, 400);
  assert.equal((await find({ q: 'x'.repeat(501) })).status, 400);
  assert.equal((await find({ q: 'x', include: 'y'.repeat(300) })).status, 400);
});
