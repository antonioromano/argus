import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig, type Launcher } from '@argus/shared';
import { AGENT_SECTION_KEYS, EXPORT_EXCLUDED_KEYS, EXPORTABLE_PREFERENCE_KEYS } from './schema.js';
import { buildExport, serializeExport } from './buildExport.js';

const LAUNCHER: Launcher = {
  id: 'api',
  label: 'API',
  request: { agent: 'claude', folder: '/Users/me/api', flags: ['--verbose'] },
  agentCommand: '/opt/homebrew/bin/claude',
  folderConfigAtSave: ['CLAUDE.md#abc'],
  createdAt: '2026-10-01T00:00:00.000Z',
};

describe('settings file classification', () => {
  it('puts every DEFAULT_CONFIG key in exactly one group', () => {
    for (const key of Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[]) {
      const groups = [EXPORTABLE_PREFERENCE_KEYS, EXPORT_EXCLUDED_KEYS, AGENT_SECTION_KEYS]
        .filter((g) => g.includes(key)).length;
      expect(groups, key).toBe(1);
    }
  });

  it('exports no key that does not exist in the config', () => {
    for (const key of EXPORTABLE_PREFERENCE_KEYS) expect(key in DEFAULT_CONFIG, key).toBe(true);
  });
});

describe('buildExport', () => {
  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    showClock: true,
    introSeen: '0.30.0',
    inspectorWidth: 420,
    customAgents: [{ id: 'aider', name: 'Aider', command: 'aider', builtin: false, stateSignals: { mechanism: 'claude-hooks', coverage: [] } }],
    agentFlags: { claude: [{ id: 'f1', value: '--verbose', enabled: true }] },
  };
  const file = buildExport({ config, templates: [], launchers: [LAUNCHER], now: new Date('2026-10-29T10:00:00Z') });
  const text = serializeExport(file);

  it('carries preferences but no bookkeeping', () => {
    expect(file.preferences.showClock).toBe(true);
    expect(file.preferences).not.toHaveProperty('introSeen');
    expect(file.preferences).not.toHaveProperty('inspectorWidth');
    expect(file.preferences).not.toHaveProperty('customAgents');
  });

  it('contains no secret-like key anywhere', () => {
    const keys: string[] = [];
    JSON.parse(text, (k, v) => { keys.push(k); return v; });
    for (const k of keys) expect(k).not.toMatch(/pass|secret|token|authtoken|credential|hash/i);
  });

  it('exports launchers without the exporting Mac’s state', () => {
    expect(file.launchers).toEqual([{ id: 'api', label: 'API', request: LAUNCHER.request }]);
    expect(text).not.toContain('agentCommand');
    expect(text).not.toContain('folderConfigAtSave');
    expect(text).not.toContain('createdAt');
  });

  it('narrows custom agents to what the file needs', () => {
    expect(file.customAgents).toEqual([{ id: 'aider', name: 'Aider', command: 'aider' }]);
  });
});
