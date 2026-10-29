import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig, type SessionTemplate } from '@argus/shared';
import { applyImport, importSummary, type ApplyDeps, type LauncherImportItem } from './applyImport.js';
import { diffImport } from './diffImport.js';
import { parseSettingsFile } from './parseSettingsFile.js';

const FILE = {
  kind: 'argus-settings',
  version: 1,
  preferences: { showClock: true, betaSessionTemplates: true },
  customAgents: [{ id: 'aider', name: 'Aider', command: 'aider' }],
  agentFlags: { claude: [{ id: 'f', value: '--verbose', enabled: true }] },
  templates: [{ name: 'Duo', specs: [{ agent: 'claude', folder: '/a' }] }, { name: 'Bad', specs: [{ agent: 'x', folder: '/b' }] }],
  launchers: [
    { id: 'api', label: 'API', request: { agent: 'claude', folder: '/x', flags: [] } },
    { id: 'gone', label: 'Gone', request: { agent: 'claude', folder: '/missing', flags: [] } },
  ],
};

function setup(config: Partial<AppConfig> = {}, templates: SessionTemplate[] = []) {
  const r = parseSettingsFile(JSON.stringify(FILE));
  if (!r.ok) throw new Error(r.error);
  const current = { config: { ...DEFAULT_CONFIG, ...config }, templates, launchers: [] };
  const plan = diffImport(r.value, current);
  const all = new Set(plan.items.map((i) => i.key));
  const calls: string[] = [];
  const deps: ApplyDeps = {
    updateConfig: vi.fn(async (patch: Partial<AppConfig>) => { calls.push('config'); return { ...current.config, ...patch } as AppConfig; }),
    createTemplate: vi.fn(async (req) => {
      calls.push(`template:${req.name}`);
      if (req.name === 'Bad') throw new Error('unknown agent');
      return {};
    }),
    updateTemplate: vi.fn(async () => { calls.push('template-update'); return {}; }),
    importLaunchers: vi.fn(async (items: LauncherImportItem[]) => {
      calls.push('launchers');
      return items.map((i) => (i.id === 'gone' ? { id: i.id, ok: false, error: 'folder not found' } : { id: i.id, ok: true }));
    }),
  };
  return { plan, all, current, deps, calls };
}

describe('applyImport', () => {
  it('writes config first, then templates, then launchers', async () => {
    const { plan, all, current, deps, calls } = setup();
    const r = await applyImport(plan, all, current, deps);
    expect(calls).toEqual(['config', 'template:Duo', 'template:Bad', 'launchers']);
    expect(r).toMatchObject({ ok: true, preferences: 2, agents: 1, flags: 1 });
    expect(r.templates).toEqual({ applied: 1, failed: [{ name: 'Bad', error: 'unknown agent' }] });
    expect(r.launchers).toEqual({ applied: 1, failed: [{ id: 'gone', error: 'folder not found' }] });
    expect(importSummary(r)).toBe(
      'Imported 2 settings, 1 agent, 1 flag set, 1 template, 1 launcher · template “Bad” skipped: unknown agent · launcher “gone” skipped: folder not found',
    );
  });

  it('merges agents and flags into the current lists', async () => {
    const existing = { id: 'mine', name: 'Mine', command: 'mine', builtin: false };
    const { plan, all, current, deps } = setup({ customAgents: [existing], agentFlags: { codex: [{ id: 'c', value: '-q', enabled: true }] } });
    await applyImport(plan, all, current, deps);
    const patch = vi.mocked(deps.updateConfig).mock.calls[0][0];
    expect(patch.customAgents).toEqual([existing, { id: 'aider', name: 'Aider', command: 'aider', builtin: false }]);
    expect(Object.keys(patch.agentFlags!)).toEqual(['codex', 'claude']);
  });

  it('aborts before templates and launchers when the config is refused', async () => {
    const { plan, all, current, deps, calls } = setup();
    vi.mocked(deps.updateConfig).mockRejectedValueOnce(new Error('Invalid command'));
    const r = await applyImport(plan, all, current, deps);
    expect(r).toMatchObject({ ok: false, error: 'Invalid command' });
    expect(calls).toEqual([]);
    expect(importSummary(r)).toContain('Nothing was changed');
  });

  it('skips templates when the beta is still off after the config write', async () => {
    const { plan, current, deps, calls } = setup();
    const noBeta = new Set(plan.items.filter((i) => i.ref !== 'betaSessionTemplates').map((i) => i.key));
    const r = await applyImport(plan, noBeta, current, deps);
    expect(r.templates.skippedReason).toMatch(/beta is off/);
    expect(calls).not.toContain('template:Duo');
  });

  it('leaves unchecked sections out of every write', async () => {
    const { plan, current, deps, calls } = setup();
    const prefsOnly = new Set(plan.items.filter((i) => i.section === 'preferences').map((i) => i.key));
    await applyImport(plan, prefsOnly, current, deps);
    expect(calls).toEqual(['config']);
    expect(Object.keys(vi.mocked(deps.updateConfig).mock.calls[0][0])).toEqual(['showClock', 'betaSessionTemplates']);
  });
});
