import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { OrphanReport } from '@argus/shared';
import { createMaintenanceRoutes } from './maintenance.js';

const report = (): OrphanReport => ({
  daemons: [{ kind: 'argusd', label: 'argus', pid: 200, alive: true, sessionIds: [], childPids: [201], treeRssKb: 10 }],
  agents: [],
  totalRssKb: 10,
});
const killed: unknown[] = [];
let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/m', createMaintenanceRoutes({
    list: async () => report(),
    kill: async (pids) => { killed.push(pids); return { accepted: [], rejected: [], signalled: [], forceKilled: [] }; },
  }));
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/m`;
});
after(async () => { await new Promise<void>((r) => server.close(() => r())); });

test('startup check notifies once per server process', async () => {
  const first = await (await fetch(`${base}/orphans?startup=1`)).json() as OrphanReport;
  const second = await (await fetch(`${base}/orphans?startup=1`)).json() as OrphanReport;
  const plain = await (await fetch(`${base}/orphans`)).json() as OrphanReport;
  assert.equal(first.notify, true);
  assert.equal(second.notify, false);
  assert.equal(plain.notify, undefined);
});

test('kill rejects a malformed pid list before touching the janitor', async () => {
  for (const body of [{}, { pids: [] }, { pids: ['1'] }, { pids: [1] }, { pids: [1.5] }]) {
    const res = await fetch(`${base}/orphans/kill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(res.status, 400);
  }
  assert.equal(killed.length, 0);
  const ok = await fetch(`${base}/orphans/kill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pids: [200] }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(killed, [[200]]);
});
