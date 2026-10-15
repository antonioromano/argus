import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentDefinition } from '@argus/shared';
import { parseTemplateInput, uniqueGroupName, validateSpec, validateSpecs } from './templates.js';

// Beta F10 spec validation: the shape check on save bodies and the full check
// (agent, folder, branch, prompt) that runs on save and again on launch.

const AGENTS: AgentDefinition[] = [
  { id: 'claude', name: 'Claude', command: 'claude', builtin: true },
  { id: 'shell', name: 'Shell', command: '/bin/zsh', builtin: true },
  { id: 'noprompt', name: 'NoPrompt', command: 'np', builtin: false },
];
const deps = { agentRegistry: { getById: (id: string) => AGENTS.find((a) => a.id === id) }, customAgents: [] };
const tmp = (t: any) => { const d = mkdtempSync(path.join(os.tmpdir(), 'argus-tpl-')); t.after(() => rmSync(d, { recursive: true, force: true })); return realpathSync(d); };

test('parse: name and spec count limits', () => {
  const spec = { agent: 'claude', folder: '/tmp' };
  assert.equal(parseTemplateInput({ name: '', specs: [spec] }).ok, false);
  assert.equal(parseTemplateInput({ name: 'x'.repeat(61), specs: [spec] }).ok, false);
  assert.equal(parseTemplateInput({ name: 'ok', specs: [] }).ok, false);
  const nine = parseTemplateInput({ name: 'ok', specs: Array(9).fill(spec) });
  assert.equal(nine.ok, false);
  assert.match((nine as { error: string }).error, /at most 8/);
  assert.equal(parseTemplateInput({ name: 'ok', specs: Array(8).fill(spec) }).ok, true);
});

test('parse: per-spec errors by index, prompt cap, empty optionals dropped', () => {
  const r = parseTemplateInput({ name: 'T', specs: [
    { agent: 'claude', folder: '/a', prompt: '   ', name: '', worktreeBranch: ' ' },
    { agent: '', folder: '/a' },
    { agent: 'claude', folder: '/a', prompt: 'x'.repeat(4001) },
    { agent: 'claude', folder: '/a', worktreeBranch: 5 },
  ] });
  assert.equal(r.ok, false);
  assert.deepEqual((r as { specErrors: Array<{ index: number }> }).specErrors.map((e) => e.index), [1, 2, 3]);
  const ok = parseTemplateInput({ name: ' T ', specs: [{ agent: 'claude', folder: '/a', prompt: '  ', name: '' }] });
  assert.deepEqual(ok, { ok: true, name: 'T', specs: [{ agent: 'claude', folder: '/a' }] });
});

test('validate: bad agent, relative / missing / file folder', async (t) => {
  const d = tmp(t);
  const file = path.join(d, 'f.txt');
  writeFileSync(file, 'x');
  for (const spec of [
    { agent: 'rm -rf', folder: d },
    { agent: 'claude', folder: 'relative/dir' },
    { agent: 'claude', folder: path.join(d, 'missing') },
    { agent: 'claude', folder: file },
  ]) {
    assert.equal((await validateSpec(spec, deps)).ok, false, JSON.stringify(spec));
  }
});

test('validate: unsafe branches are refused, a normal one passes', async (t) => {
  const d = tmp(t);
  for (const b of ['-evil', 'a..b', 'has space', 'x;rm', 'end/', 'x.lock', 'a'.repeat(201)]) {
    assert.equal((await validateSpec({ agent: 'claude', folder: d, worktreeBranch: b }, deps)).ok, false, b);
  }
  assert.equal((await validateSpec({ agent: 'claude', folder: d, worktreeBranch: 'feat/api-1' }, deps)).ok, true);
});

test('validate: prompt rules', async (t) => {
  const d = tmp(t);
  assert.equal((await validateSpec({ agent: 'claude', folder: d, prompt: 'x'.repeat(4001) }, deps)).ok, false);
  assert.equal((await validateSpec({ agent: 'claude', folder: d, prompt: '--dangerously' }, deps)).ok, false);
  assert.equal((await validateSpec({ agent: 'noprompt', folder: d, prompt: 'hi' }, deps)).ok, false);
  assert.equal((await validateSpec({ agent: 'shell', folder: d, prompt: 'hi' }, deps)).ok, false);
  assert.equal((await validateSpec({ agent: 'claude', folder: d, prompt: "it's $(rm -rf ~) `x`" }, deps)).ok, true);
});

test('validate: folder comes back realpath\'d', async (t) => {
  const d = tmp(t);
  const link = path.join(d, 'link');
  symlinkSync(d, link);
  const r = await validateSpec({ agent: 'claude', folder: link }, deps);
  assert.deepEqual(r, { ok: true, spec: { agent: 'claude', folder: d } });
});

test('validateSpecs reports every failing index', async (t) => {
  const d = tmp(t);
  const r = await validateSpecs([{ agent: 'claude', folder: d }, { agent: 'nope', folder: d }, { agent: 'claude', folder: 'rel' }], deps);
  assert.equal(r.ok, false);
  assert.deepEqual((r as { specErrors: Array<{ index: number }> }).specErrors.map((e) => e.index), [1, 2]);
});

test('uniqueGroupName adds a timestamp only when the name is taken', () => {
  const now = new Date(2026, 9, 15, 9, 5, 7);
  assert.equal(uniqueGroupName('API', new Set(['Other']), now), 'API');
  assert.equal(uniqueGroupName('API', new Set(['API']), now), 'API · 2026-10-15 09:05');
  assert.equal(uniqueGroupName('API', new Set(['API', 'API · 2026-10-15 09:05']), now), 'API · 2026-10-15 09:05:07');
  assert.equal(uniqueGroupName('API', new Set(['API', 'API · 2026-10-15 09:05', 'API · 2026-10-15 09:05:07']), now), 'API · 2026-10-15 09:05:07 (2)');
});
