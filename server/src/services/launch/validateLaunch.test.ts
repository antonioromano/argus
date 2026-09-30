import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentRegistry } from '../AgentRegistry.js';
import { validateLaunch, MAX_QUOTED_BYTES } from './validateLaunch.js';

function fixture(t: any) {
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'argus-vl-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const inRoot = path.join(home, 'development', 'proj');
  const outside = path.join(home, 'Downloads', 'x');
  mkdirSync(inRoot, { recursive: true });
  mkdirSync(outside, { recursive: true });
  const config = { customAgents: [], launchFolderRoots: ['~/development'] } as any;
  const deps = { agentRegistry: new AgentRegistry(), config, home };
  return { home, inRoot, outside, deps };
}

test('valid request: args, display command, no warnings inside roots', async (t) => {
  const { inRoot, deps } = fixture(t);
  const r = await validateLaunch({ agent: 'claude', folder: inRoot, flags: ['--model=opus'], prompt: "it's done" }, deps);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value.args, ["it's done", '--model=opus']);
  assert.equal(r.value.command, `claude 'it'\\''s done' --model=opus`);
  assert.equal(r.value.agentCommand, 'claude');
  assert.deepEqual(r.value.warnings, []);
});

test('rejects unknown agent, missing folder, file as folder, bad flags', async (t) => {
  const { inRoot, deps } = fixture(t);
  const file = path.join(inRoot, 'f.txt'); writeFileSync(file, 'x');
  assert.equal((await validateLaunch({ agent: 'nope', folder: inRoot, flags: [] }, deps)).ok, false);
  assert.equal((await validateLaunch({ agent: 'claude', folder: inRoot + '/missing', flags: [] }, deps)).ok, false);
  assert.equal((await validateLaunch({ agent: 'claude', folder: file, flags: [] }, deps)).ok, false);
  assert.equal((await validateLaunch({ agent: 'claude', folder: inRoot, flags: ['--a;b'] }, deps)).ok, false);
});

test('prompt on an agent without prompt support is rejected', async (t) => {
  const { inRoot, deps } = fixture(t);
  deps.config.customAgents = [{ id: 'x', name: 'X', command: 'x', builtin: false }];
  const r = await validateLaunch({ agent: 'x', folder: inRoot, flags: [], prompt: 'hi' }, deps);
  assert.equal(r.ok, false);
});

test('quoted size cap', async (t) => {
  const { inRoot, deps } = fixture(t);
  const r = await validateLaunch({ agent: 'claude', folder: inRoot, flags: [], prompt: "'".repeat(4000) }, deps);
  assert.equal(r.ok, false);
  assert.match((r as any).error, new RegExp(String(MAX_QUOTED_BYTES)));
});

test('warnings: outside roots, agent config, worktree', async (t) => {
  const { outside, deps } = fixture(t);
  mkdirSync(path.join(outside, '.claude'));
  writeFileSync(path.join(outside, 'CLAUDE.md'), '#');
  const r = await validateLaunch({ agent: 'claude', folder: outside, flags: [], worktree: 'feat/x', base: 'main' }, deps);
  assert.ok(r.ok);
  const kinds = r.value.warnings.map((w) => w.kind).sort();
  assert.deepEqual(kinds, ['folder-agent-config', 'folder-outside-roots', 'worktree']);
  assert.deepEqual(r.value.folderAgentConfig.map((e) => e.split('#')[0]), ['.claude/', 'CLAUDE.md']);
  const cfg = r.value.warnings.find((w) => w.kind === 'folder-agent-config')!;
  assert.equal(cfg.detail, 'Loads when the agent starts: .claude/, CLAUDE.md');
});

test('folderAgentConfig hashes contents of every agent config file, sorted', async (t) => {
  const { inRoot, deps } = fixture(t);
  mkdirSync(path.join(inRoot, '.claude'));
  mkdirSync(path.join(inRoot, '.gemini'));
  const files = ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json', 'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.gemini/settings.json'];
  for (const f of files) writeFileSync(path.join(inRoot, f), `content of ${f}`);
  const r = await validateLaunch({ agent: 'claude', folder: inRoot, flags: [] }, deps);
  assert.ok(r.ok);
  const entries = r.value.folderAgentConfig;
  assert.deepEqual(entries.map((e) => e.split('#')[0]), [...files].sort());
  assert.deepEqual([...entries].sort(), entries, 'sorted');
  for (const e of entries) assert.match(e, /^[^#]+#[0-9a-f]{16}$/);
  const detail = r.value.warnings.find((w) => w.kind === 'folder-agent-config')!.detail;
  assert.ok(!/#[0-9a-f]{16}/.test(detail), 'detail lists relpaths, no hashes');
  assert.ok(files.every((f) => detail.includes(f)));

  writeFileSync(path.join(inRoot, 'CLAUDE.md'), 'edited');
  const r2 = await validateLaunch({ agent: 'claude', folder: inRoot, flags: [] }, deps);
  assert.ok(r2.ok);
  assert.notDeepEqual(r2.value.folderAgentConfig, entries, 'a content edit changes the entry');
  assert.ok(!r2.value.folderAgentConfig.includes('.claude/'), 'no bare .claude/ entry when its files exist');
});

test('folder is realpath-resolved', async (t) => {
  const { inRoot, deps } = fixture(t);
  const r = await validateLaunch({ agent: 'claude', folder: inRoot + '/./', flags: [] }, deps);
  assert.ok(r.ok);
  assert.equal(r.value.request.folder, inRoot);
});

test('prompt must not start with "-" (defence in depth for saved launchers)', async (t) => {
  const { inRoot, deps } = fixture(t);
  const a = await validateLaunch({ agent: 'claude', folder: inRoot, flags: [], prompt: '--dangerously-skip-permissions' }, deps);
  assert.equal(a.ok, false);
  assert.match((a as any).error, /must not start/);
  assert.equal((await validateLaunch({ agent: 'claude', folder: inRoot, flags: [], prompt: '  -p' }, deps)).ok, false);
});

test('folder must be absolute', async (t) => {
  const { deps } = fixture(t);
  for (const folder of ['', 'relative/x']) {
    const r = await validateLaunch({ agent: 'claude', folder, flags: [] }, deps);
    assert.equal(r.ok, false);
    assert.match((r as any).error, /absolute/);
  }
});
