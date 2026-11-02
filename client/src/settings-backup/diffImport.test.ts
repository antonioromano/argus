import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig, type SessionTemplate } from '@argus/shared';
import { diffImport } from './diffImport.js';
import { parseSettingsFile, type ParsedSettings } from './parseSettingsFile.js';

function parsed(extra: Record<string, unknown>): ParsedSettings {
  const r = parseSettingsFile(JSON.stringify({ kind: 'argus-settings', version: 1, ...extra }));
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

const TEMPLATE: SessionTemplate = {
  id: 't1', name: 'Trio', specs: [{ agent: 'claude', folder: '/a' }], createdAt: 'x', updatedAt: 'x',
};

const base = (config: Partial<AppConfig> = {}) => ({
  config: { ...DEFAULT_CONFIG, ...config },
  templates: [TEMPLATE],
  launchers: [{ id: 'api', label: 'API', request: { agent: 'claude', folder: '/x', flags: [] }, agentCommand: 'c', folderConfigAtSave: [], createdAt: 'x' }],
});

describe('diffImport', () => {
  it('omits unchanged preferences and labels changed ones from the catalog', () => {
    const plan = diffImport(parsed({ preferences: { showClock: false, uiFontSize: 18 } }), base());
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({ key: 'preferences:uiFontSize', label: 'Interface', before: 'Medium', after: 'X-Large', defaultSelected: true });
  });

  it('marks sensitive preferences unchecked and notes the relaunch for ptyBackend', () => {
    const plan = diffImport(parsed({ preferences: { autoApprovalEnabled: true, ptyBackend: 'tmux' } }), base());
    const pty = plan.items.find((i) => i.ref === 'ptyBackend')!;
    expect(pty.note).toMatch(/relaunch/i);
    expect(plan.items.every((i) => i.sensitive && !i.defaultSelected)).toBe(true);
  });

  it('shows a changed custom agent’s command before and after', () => {
    const plan = diffImport(
      parsed({ customAgents: [{ id: 'aider', name: 'Aider', command: 'aider --yes' }] }),
      base({ customAgents: [{ id: 'aider', name: 'Aider', command: 'aider', builtin: false }] }),
    );
    expect(plan.items).toEqual([expect.objectContaining({ section: 'agents', before: 'aider', after: 'aider --yes', status: 'changed', sensitive: true, defaultSelected: false })]);
  });

  it('reports a template with the same name and specs as identical, skipped', () => {
    const plan = diffImport(parsed({ templates: [{ name: 'Trio', specs: [{ agent: 'claude', folder: '/a' }] }] }), base());
    expect(plan.items[0]).toMatchObject({ status: 'identical', note: 'Identical, skipped', defaultSelected: false });
  });

  it('defaults a launcher id collision to not overwrite', () => {
    const plan = diffImport(parsed({ launchers: [
      { id: 'api', label: 'API v2', request: { agent: 'claude', folder: '/y', flags: [] } },
      { id: 'web', label: 'Web', request: { agent: 'claude', folder: '/w', flags: [] } },
    ] }), base());
    expect(plan.items.find((i) => i.ref === 'api')).toMatchObject({ status: 'changed', defaultSelected: false });
    expect(plan.items.find((i) => i.ref === 'web')).toMatchObject({ status: 'new', defaultSelected: true });
  });
});
