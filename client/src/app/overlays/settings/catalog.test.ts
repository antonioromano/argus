import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import {
  SETTINGS,
  SETTINGS_BY_ID,
  isSettingModified,
  isSettingVisible,
  settingHint,
  settingValueLabel,
} from './catalog.js';
import { PANES, PANES_BY_ID } from './registry.js';
import { SHORTCUTS } from '../../../keyboard/registry.js';
import { BETA_FEATURES } from '../../../utils/betaFlags.js';

const base = (): AppConfig => structuredClone(DEFAULT_CONFIG);

describe('settings catalog', () => {
  it('has unique ids', () => {
    const ids = SETTINGS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The overlay finds a row with a quoted [data-setting-id="…"] selector and
  // the DOM id is `setting-<id>`; keep ids to characters both accept verbatim.
  it('uses ids safe for a DOM id and an attribute selector', () => {
    for (const s of SETTINGS) expect(s.id).toMatch(/^[\w:-]+$/);
  });

  it('places every setting on a registered pane', () => {
    for (const s of SETTINGS) expect(PANES_BY_ID[s.pane], s.id).toBeDefined();
  });

  // The registry's `keys` are derived from the catalog, so the modified dot,
  // the footer count and Reset all cannot drift from what the panes render.
  it('is where each pane gets its config keys', () => {
    for (const pane of PANES) {
      const fromCatalog = new Set(
        SETTINGS.filter((s) => s.pane === pane.id && s.source !== 'device').flatMap((s) => s.keys),
      );
      expect([...pane.keys].sort(), pane.id).toEqual([...fromCatalog].sort());
    }
  });

  it('gives every choice its option labels', () => {
    for (const s of SETTINGS.filter((d) => d.kind === 'choice')) {
      expect(s.options?.length, s.id).toBeGreaterThan(0);
    }
  });

  it('only reveals through an existing setting on the same pane', () => {
    for (const s of SETTINGS.filter((d) => d.revealVia)) {
      const parent = SETTINGS_BY_ID[s.revealVia!];
      expect(parent, s.id).toBeDefined();
      expect(parent.pane, s.id).toBe(s.pane);
      expect(s.visibleWhen, `${s.id} has revealVia but is never hidden`).toBeDefined();
    }
  });

  // Plan 001 may flip a `palette: 'toggle'` setting in place; that is only safe
  // for a single plain boolean.
  it('marks only single boolean keys as palette toggles', () => {
    for (const s of SETTINGS.filter((d) => d.palette === 'toggle')) {
      expect(s.keys.length, s.id).toBe(1);
      expect(typeof DEFAULT_CONFIG[s.keys[0]], s.id).toBe('boolean');
    }
  });

  it('keeps settings with confirms or side effects out of palette toggles', () => {
    for (const id of ['autoApprovalEnabled', 'ptyBackend', 'exitSessionsOnQuit', 'notificationsEnabled']) {
      expect(SETTINGS_BY_ID[id].palette, id).not.toBe('toggle');
    }
  });

  it('generates one setting per shortcut and per beta feature', () => {
    for (const s of SHORTCUTS) {
      const d = SETTINGS_BY_ID[`shortcut:${s.id}`];
      expect(d.label).toBe(s.label);
      expect(d.pane).toBe('keyboard');
      expect(d.keys).toEqual(['keyboardShortcuts']);
    }
    for (const f of BETA_FEATURES) {
      const d = SETTINGS_BY_ID[`beta:${f.flag}`];
      expect(d.label).toBe(f.label);
      expect(d.keys).toEqual([f.flag]);
    }
  });

  it('keeps theme mode as a device setting that writes no config', () => {
    const d = SETTINGS_BY_ID['device:themeMode'];
    expect(d.source).toBe('device');
    expect(d.keys).toEqual([]);
  });
});

describe('visibility and hints', () => {
  it('hides the seconds toggle until the clock is on', () => {
    const d = SETTINGS_BY_ID.clockShowSeconds;
    expect(isSettingVisible(d, { ...base(), showClock: false })).toBe(false);
    expect(isSettingVisible(d, { ...base(), showClock: true })).toBe(true);
    expect(d.revealVia).toBe('showClock');
  });

  it('shows exactly one of the two quit confirmations', () => {
    const detach = { ...base(), exitSessionsOnQuit: false };
    const exit = { ...base(), exitSessionsOnQuit: true };
    expect(isSettingVisible(SETTINGS_BY_ID.confirmQuitDirectSessions, detach)).toBe(true);
    expect(isSettingVisible(SETTINGS_BY_ID.confirmExitOnQuit, detach)).toBe(false);
    expect(isSettingVisible(SETTINGS_BY_ID.confirmQuitDirectSessions, exit)).toBe(false);
    expect(isSettingVisible(SETTINGS_BY_ID.confirmExitOnQuit, exit)).toBe(true);
  });

  it('computes value-dependent hints from config', () => {
    const d = SETTINGS_BY_ID.claudeRenderer;
    expect(settingHint(d, { ...base(), claudeRenderer: 'classic' })).toContain('Native terminal scrollback');
    expect(settingHint(d, { ...base(), claudeRenderer: 'fullscreen' })).toContain('re-lays it out');
  });
});

describe('value labels and modified state', () => {
  it('labels toggles On/Off, falling back to the default', () => {
    expect(settingValueLabel(SETTINGS_BY_ID.showClock, { ...base(), showClock: true })).toBe('On');
    const absent = base();
    delete absent.showClock;
    expect(settingValueLabel(SETTINGS_BY_ID.showClock, absent)).toBe('Off');
  });

  it('labels choices by their option label', () => {
    expect(settingValueLabel(SETTINGS_BY_ID.uiFontSize, { ...base(), uiFontSize: 18 })).toBe('X-Large');
    expect(settingValueLabel(SETTINGS_BY_ID.mosaicOrientation, base())).toBe('Side by side');
  });

  it('reports a setting modified only when one of its keys differs from the default', () => {
    expect(isSettingModified(SETTINGS_BY_ID.uiFontSize, base())).toBe(false);
    expect(isSettingModified(SETTINGS_BY_ID.uiFontSize, { ...base(), uiFontSize: 18 })).toBe(true);
    expect(isSettingModified(SETTINGS_BY_ID['device:themeMode'], base())).toBe(false);
  });

  it('tracks shortcut overrides per action, not per map', () => {
    const config = { ...base(), keyboardShortcuts: { 'new-session': 'mod+shift+n' } };
    expect(isSettingModified(SETTINGS_BY_ID['shortcut:new-session'], config)).toBe(true);
    expect(isSettingModified(SETTINGS_BY_ID['shortcut:open-settings'], config)).toBe(false);
  });
});
