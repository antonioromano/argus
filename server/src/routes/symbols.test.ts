import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { SessionManager } from '../services/SessionManager.js';
import { createSymbolRoutes } from './symbols.js';

// Integration test: real express app + a temp repo. The SessionManager is faked
// to the single method the route calls (sessionForPath), scoping every request
// to the temp repo.

let dir: string;
let server: Server;
let base: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'argus-symbols-test-'));
  await writeFile(join(dir, 'foo.ts'), 'export function helper() {\n  return 1;\n}\n');
  await writeFile(join(dir, 'bar.ts'), "import { helper } from './foo';\nconst x = helper();\nexport function helper2() { return helper(); }\n");
  // Collision: a second definition of `helper` in a nested dir.
  await mkdir(join(dir, 'nested'), { recursive: true });
  await writeFile(join(dir, 'nested', 'dup.ts'), 'function helper() { return 2; }\n');
  // Should be ignored by the dir excludes.
  await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(join(dir, 'node_modules', 'pkg', 'index.ts'), 'export function helper() {}\n');

  const fakeSm = {
    sessionForPath: (rawPath: string) => {
      if (!rawPath.startsWith(dir)) return null;
      return { session: { folderPath: dir }, resolved: rawPath };
    },
  } as unknown as SessionManager;

  const app = express();
  app.use('/symbols', createSymbolRoutes(fakeSm));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/symbols`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

async function get(route: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${base}/${route}?${qs}`);
  return { status: res.status, body: await res.json() as any };
}

test('definition finds a cross-file function definition, ranked strong', async () => {
  const { status, body } = await get('definition', { path: join(dir, 'bar.ts'), symbol: 'helper', line: '2' });
  assert.equal(status, 200);
  assert.ok(body.locations.length >= 1, 'expected at least one definition');
  const top = body.locations[0];
  assert.match(top.preview, /function helper/);
  assert.equal(top.kind, 'function');
  assert.equal(top.confidence, 'strong');
  // node_modules is excluded.
  assert.ok(!body.locations.some((l: any) => l.path.includes('node_modules')));
  // Internal sort keys must not leak onto the wire.
  assert.ok(!('_rank' in top) && !('_sameFile' in top), 'internal keys leaked');
});

test('definition ranks same-file definition above a remote one', async () => {
  // From dup.ts: the local helper() definition should outrank foo.ts's.
  const { body } = await get('definition', { path: join(dir, 'nested', 'dup.ts'), symbol: 'helper', line: '99' });
  assert.ok(body.locations.length >= 2, 'expected the collision to produce multiple candidates');
  assert.equal(body.locations[0].path, join(dir, 'nested', 'dup.ts'));
});

test('definition drops the exact invocation site', async () => {
  // Invoke from foo.ts line 1 (the definition itself) — it must not be returned.
  const { body } = await get('definition', { path: join(dir, 'foo.ts'), symbol: 'helper', line: '1' });
  assert.ok(!body.locations.some((l: any) => l.path === join(dir, 'foo.ts') && l.line === 1));
});

test('references returns every whole-word usage', async () => {
  const { body } = await get('references', { path: join(dir, 'bar.ts'), symbol: 'helper' });
  // foo.ts def + bar.ts (import, call, call inside helper2) + dup.ts def. helper2 must NOT match (whole word).
  assert.ok(body.locations.length >= 4, `expected >=4 refs, got ${body.locations.length}`);
  assert.ok(body.locations.every((l: any) => !l.preview.includes('helper2(') || l.preview.includes('helper(')));
  assert.ok(body.locations.some((l: any) => l.path === join(dir, 'bar.ts')));
});

test('invalid symbol returns empty without scanning', async () => {
  const { status, body } = await get('definition', { path: join(dir, 'bar.ts'), symbol: 'a.*', line: '1' });
  assert.equal(status, 200);
  assert.deepEqual(body.locations, []);
});

test('path outside any session is rejected 403', async () => {
  const { status } = await get('definition', { path: '/etc/passwd', symbol: 'root', line: '1' });
  assert.equal(status, 403);
});
