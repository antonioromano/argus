import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OrphanJanitor,
  agentOf,
  classifyOrphans,
  parseLsofCwd,
  parsePs,
  validateKillRequest,
  type JanitorContext,
} from './OrphanJanitor.js';

const DIR = '/Users/me/Library/Application Support/argus-dev';
const OTHER_DIR = '/Users/me/Library/Application Support/argus';
const S1 = '11111111-1111-1111-1111-111111111111';
const S2 = '22222222-2222-2222-2222-222222222222';

// A dev data dir with the active daemon (100, label argus-dev) and a duplicate
// started under the wrong label (200, label argus) running the same session.
// 300 is the packaged app's daemon on ANOTHER data dir: never ours to touch.
// 400 is this app's tmux server, left over from before the switch to argusd.
const PS = `  PID  PPID    RSS COMMAND
    1     0   9000 /sbin/launchd
  100     1   7000 /Applications/Argus.app/Contents/Resources/argusd/argusd-arm64 ${DIR}/argusd-argus-dev.sock
  101   100 150000 claude --settings ${DIR}/signals/${S1}.json
  102   100 160000 claude --settings ${DIR}/signals/${S2}.json
  200     1   6000 /Applications/Argus.app/Contents/Resources/argusd/argusd-arm64 ${DIR}/argusd-argus.sock
  201   200 145000 claude --settings ${DIR}/signals/${S1}.json
  202   201  20000 node /Users/me/.npm/mcp-server.js
  203   200   1000 /bin/zsh -l
  204   203  90000 node /opt/homebrew/bin/gemini --yolo
  300     1   7100 /Applications/Argus.app/Contents/Resources/argusd/argusd-arm64 ${OTHER_DIR}/argusd-argus.sock
  301   300 500000 claude --settings ${OTHER_DIR}/signals/${S2}.json
  400     1   3000 /Applications/Argus.app/Contents/Resources/tmux -L argus-dev new-session -d -s argus-x
  401   400   1000 -zsh
  402   401 130000 codex
  500   900   2000 /Applications/Argus.app/Contents/Resources/tmux -L argus-dev attach -t argus-x
  600     1   3000 tmux new-session -s mine
  601   600 120000 claude
garbage line
`;

const ctx: JanitorContext = {
  dataDir: DIR,
  activeSocket: `${DIR}/argusd-argus-dev.sock`,
  activeDaemonPid: 100,
  tmuxLabel: 'argus-dev',
  tmuxActive: false,
  selfPid: 900,
};

test('parsePs: skips header and malformed lines, keeps spaces in commands', () => {
  const rows = parsePs(PS);
  assert.equal(rows.length, 17);
  assert.deepEqual(rows.find((r) => r.pid === 101), {
    pid: 101, ppid: 100, rssKb: 150000, command: `claude --settings ${DIR}/signals/${S1}.json`,
  });
});

test('agentOf: native binaries and node-hosted CLIs', () => {
  assert.equal(agentOf('claude --settings x'), 'claude');
  assert.equal(agentOf('/usr/local/bin/codex'), 'codex');
  assert.equal(agentOf('node /opt/homebrew/bin/gemini --yolo'), 'gemini');
  assert.equal(agentOf('node /x/server.js'), null);
  assert.equal(agentOf('/bin/zsh -l'), null);
});

test('classifyOrphans: lists the duplicate daemon and our stale tmux server only', () => {
  const report = classifyOrphans(parsePs(PS), ctx);
  assert.deepEqual(report.daemons.map((d) => [d.kind, d.label, d.pid]), [
    ['argusd', 'argus', 200],
    ['tmux', 'argus-dev', 400],
  ]);
  const dup = report.daemons[0];
  assert.deepEqual(dup.childPids, [201, 203, 202, 204]);
  assert.deepEqual(dup.sessionIds, [S1]);
  assert.equal(dup.treeRssKb, 6000 + 145000 + 20000 + 1000 + 90000);
  // The MCP helper under claude is part of claude's tree, not a separate agent.
  assert.deepEqual(report.agents.map((a) => [a.pid, a.agent, a.daemonPid, a.sessionId]), [
    [201, 'claude', 200, S1],
    [204, 'gemini', 200, null],
    [402, 'codex', 400, null],
  ]);
  assert.equal(report.totalRssKb, dup.treeRssKb + 3000 + 1000 + 130000);
});

test('classifyOrphans: the active daemon, other data dirs and foreign tmux are never listed', () => {
  const report = classifyOrphans(parsePs(PS), ctx);
  const pids = new Set([...report.daemons.flatMap((d) => [d.pid, ...d.childPids]), ...report.agents.map((a) => a.pid)]);
  for (const p of [100, 101, 102, 300, 301, 500, 600, 601]) assert.ok(!pids.has(p), `pid ${p} must not be listed`);
});

test('classifyOrphans: the active daemon is protected by pid even if its socket is unknown', () => {
  const report = classifyOrphans(parsePs(PS), { ...ctx, activeSocket: null });
  assert.ok(!report.daemons.some((d) => d.pid === 100));
});

test('classifyOrphans: the tmux server is not an orphan while tmux is the backend', () => {
  const report = classifyOrphans(parsePs(PS), { ...ctx, tmuxActive: true });
  assert.ok(!report.daemons.some((d) => d.kind === 'tmux'));
});

test('classifyOrphans: a daemon we run inside is never offered', () => {
  // A dev server started from a terminal of the duplicate daemon.
  const rows = parsePs(`${PS}  900   203  80000 node server/dist/index.js\n`);
  const report = classifyOrphans(rows, ctx);
  assert.ok(!report.daemons.some((d) => d.pid === 200));
});

test('validateKillRequest: rejects pids outside the fresh orphan set', () => {
  const rows = parsePs(PS);
  const report = classifyOrphans(rows, ctx);
  const v = validateKillRequest([200, 100, 101, 300, 1, 900, 'x', 204], report, rows);
  assert.deepEqual(v.accepted, [200, 204]);
  assert.deepEqual(v.rejected, [100, 101, 300, 1, 900]);
  assert.deepEqual(v.targets.sort((a, b) => a - b), [200, 201, 202, 203, 204]);
});

test('validateKillRequest: a non-array request accepts nothing', () => {
  const rows = parsePs(PS);
  const v = validateKillRequest({ pids: [200] }, classifyOrphans(rows, ctx), rows);
  assert.deepEqual(v, { accepted: [], rejected: [], targets: [] });
});

test('parseLsofCwd', () => {
  assert.deepEqual([...parseLsofCwd('p201\nfcwd\nn/Users/me/proj\np204\nfcwd\nn/tmp\n')], [
    [201, '/Users/me/proj'],
    [204, '/tmp'],
  ]);
});

test('OrphanJanitor.kill: TERM the validated tree, KILL survivors, never the active daemon', async () => {
  const sent: [number, string][] = [];
  const janitor = new OrphanJanitor({
    context: () => ctx,
    readPs: async () => parsePs(PS),
    kill: (pid, sig) => { sent.push([pid, sig]); },
    isAlive: (pid) => pid === 201, // claude ignores SIGTERM
    sleep: async () => {},
  });
  const res = await janitor.kill([201, 100]);
  assert.deepEqual(res.accepted, [201]);
  assert.deepEqual(res.rejected, [100]);
  assert.deepEqual(res.signalled.sort(), [201, 202]);
  assert.deepEqual(res.forceKilled, [201]);
  assert.ok(!sent.some(([p]) => p === 100));
});

test('OrphanJanitor.list: fills cwd from lsof', async () => {
  const janitor = new OrphanJanitor({
    context: () => ctx,
    readPs: async () => parsePs(PS),
    readCwds: async () => new Map([[201, '/Users/me/proj']]),
  });
  const report = await janitor.list();
  assert.equal(report.agents.find((a) => a.pid === 201)?.cwd, '/Users/me/proj');
  assert.equal(report.agents.find((a) => a.pid === 204)?.cwd, null);
});
