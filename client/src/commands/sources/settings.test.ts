import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import { settingsSource, stepPreset } from './settings.js';
import { stubContext } from './testContext.js';
import { CODE_FONT_PRESETS } from '../../app/overlays/settings/options.js';

describe('settingsSource', () => {
  it('opens every pane', () => {
    const openSettings = vi.fn();
    const c = settingsSource(stubContext({ openSettings })).find((x) => x.id === 'settings.pane:notifications')!;
    expect(c.title).toBe('Open Notifications settings');
    c.run();
    expect(openSettings).toHaveBeenCalledWith('notifications');
  });

  it("flips a palette: 'toggle' setting and shows its state", () => {
    const updateConfig = vi.fn();
    const c = settingsSource(stubContext({ config: { ...DEFAULT_CONFIG, showClock: true }, updateConfig }))
      .find((x) => x.id === 'settings.toggle:showClock')!;
    expect(c.checked).toBe(true);
    c.run();
    expect(updateConfig).toHaveBeenCalledWith({ showClock: false });
  });

  it('hides a toggle while its parent is off (seconds without the clock)', () => {
    const c = settingsSource(stubContext()).find((x) => x.id === 'settings.toggle:clockShowSeconds')!;
    expect(c.when).toBe(false);
  });

  it('opens the pane at the row for notifications, auto-approval and quit behaviour', () => {
    const openSettings = vi.fn();
    const cmds = settingsSource(stubContext({ openSettings }));
    for (const [id, pane] of [['notificationsEnabled', 'notifications'], ['autoApprovalEnabled', 'auto-approval'], ['exitSessionsOnQuit', 'general']]) {
      expect(cmds.some((c) => c.id === `settings.toggle:${id}`)).toBe(false);
      const open = cmds.find((c) => c.id === `settings.open:${id}`)!;
      expect(open.focusKey).toBe(id);
      open.run();
      expect(openSettings).toHaveBeenLastCalledWith(pane, id);
    }
  });

  it('sets a choice in place, marks the current option, writes numbers as numbers', () => {
    const updateConfig = vi.fn();
    const setThemeMode = vi.fn();
    const cmds = settingsSource(stubContext({ updateConfig, setThemeMode, themeMode: 'dark' }));
    expect(cmds.find((c) => c.id === 'settings.set:mosaicOrientation=horizontal')!.checked).toBe(true);
    cmds.find((c) => c.id === 'settings.set:mosaicOrientation=vertical')!.run();
    expect(updateConfig).toHaveBeenCalledWith({ mosaicOrientation: 'vertical' });
    cmds.find((c) => c.id === 'settings.set:codeFontSize=15')!.run();
    expect(updateConfig).toHaveBeenCalledWith({ codeFontSize: 15 });
    expect(cmds.find((c) => c.id === 'settings.set:device:themeMode=dark')!.checked).toBe(true);
    cmds.find((c) => c.id === 'settings.set:device:themeMode=light')!.run();
    expect(setThemeMode).toHaveBeenCalledWith('light');
  });

  it('leaves shortcut and beta rows to their own sources', () => {
    const ids = settingsSource(stubContext()).map((c) => c.id);
    expect(ids.some((id) => /:(shortcut|beta):/.test(id))).toBe(false);
  });

  it('steps text size through the presets, keeps the palette open, and resets', () => {
    const updateConfig = vi.fn();
    const cmds = settingsSource(stubContext({ updateConfig }));
    const bigger = cmds.find((c) => c.id === 'font:bigger')!;
    expect(bigger.keepOpen).toBe(true);
    bigger.run();
    expect(updateConfig).toHaveBeenCalledWith({ codeFontSize: 15, uiFontSize: 16 });
    expect(cmds.find((c) => c.id === 'font:reset')!.when).toBe(false);
    expect(stepPreset(CODE_FONT_PRESETS, 17, 1)).toBe(17);
    expect(stepPreset(CODE_FONT_PRESETS, 11, -1)).toBe(11);
    expect(stepPreset(CODE_FONT_PRESETS, 14, -1)).toBe(13);
  });
});

describe('Show modified settings (plan 007)', () => {
  it('opens the Modified view, and only while something differs from its default', () => {
    const openSettings = vi.fn();
    const find = (config: AppConfig) => settingsSource(stubContext({ openSettings, config })).find((x) => x.id === 'settings.ux:show-modified')!;
    expect(find(DEFAULT_CONFIG).when).toBe(false);
    const c = find({ ...DEFAULT_CONFIG, showClock: true });
    expect(c.when).toBe(true);
    expect(c.hint).toBe('1 changed');
    c.run();
    expect(openSettings).toHaveBeenCalledWith('modified');
  });
});
