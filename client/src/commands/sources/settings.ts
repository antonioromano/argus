import { AArrowDown, AArrowUp, ListChecks, Settings2, Type } from 'lucide-react';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import { PANES, PANES_BY_ID, modifiedSettings } from '../../app/overlays/settings/registry.js';
import { SETTINGS, isSettingVisible, type SettingDescriptor } from '../../app/overlays/settings/catalog.js';
import { CODE_FONT_PRESETS, DEFAULT_CODE_FONT_PX, DEFAULT_UI_FONT_PX, UI_FONT_PRESETS } from '../../app/overlays/settings/options.js';
import type { ThemeMode } from '../../context/theme-context.js';
import type { Command } from '../types.js';
import type { CommandContext } from './context.js';

/**
 * Choices the palette sets in place, one row per option ("Shell layout:
 * Stacked"), with the name each row leads with. Every other choice opens its
 * pane. The backend is left out on purpose: switching it is a restart-scale
 * change that deserves its hint text.
 */
export const PALETTE_CHOICES: Readonly<Record<string, string>> = {
  'device:themeMode': 'Theme',
  density: 'Density',
  codeFontSize: 'Code font size',
  uiFontSize: 'Interface font size',
  mosaicOrientation: 'Session layout',
  mosaicWaitingStyle: 'Waiting style',
  inspectorSide: 'Inspector position',
  tileRunningIndicator: 'Running indicator',
  claudeRenderer: 'Claude renderer',
  defaultSessionView: 'Default Claude view',
};

/** Catalog rows other sources own: shortcuts and beta flags. */
const OWNED_ELSEWHERE = /^(shortcut|beta):/;

function currentValue(ctx: CommandContext, s: SettingDescriptor): string {
  if (s.id === 'device:themeMode') return ctx.themeMode;
  const key = s.keys[0];
  const config = ctx.config ?? DEFAULT_CONFIG;
  return String(config[key] ?? DEFAULT_CONFIG[key]);
}

function setChoice(ctx: CommandContext, s: SettingDescriptor, value: string): void {
  if (s.id === 'device:themeMode') { ctx.setThemeMode(value as ThemeMode); return; }
  const key = s.keys[0];
  const typed = typeof DEFAULT_CONFIG[key] === 'number' ? Number(value) : value;
  ctx.updateConfig({ [key]: typed } as Partial<AppConfig>);
}

function settingCommands(ctx: CommandContext, s: SettingDescriptor): Command[] {
  const pane = PANES_BY_ID[s.pane];
  const config = ctx.config ?? DEFAULT_CONFIG;
  const keywords = [s.label, s.section, pane.label, ...(s.keywords ?? [])].join(' ');
  const when = isSettingVisible(s, config);

  if (s.kind === 'toggle' && s.palette === 'toggle') {
    const key = s.keys[0];
    const on = (config[key] ?? DEFAULT_CONFIG[key]) === true;
    return [{
      id: `settings.toggle:${s.id}`,
      title: s.label,
      category: 'Settings',
      hint: `${pane.label} · ${on ? 'On' : 'Off'}`,
      keywords: `${keywords} toggle on off enable disable`,
      checked: on,
      source: 'settings',
      when,
      run: () => ctx.updateConfig({ [key]: !on } as Partial<AppConfig>),
    }];
  }

  const name = PALETTE_CHOICES[s.id];
  if (s.kind === 'choice' && name && s.options) {
    const current = currentValue(ctx, s);
    return s.options.map((o) => ({
      id: `settings.set:${s.id}=${o.value}`,
      title: `${name}: ${o.label}`,
      category: 'Settings',
      hint: pane.label,
      keywords,
      checked: o.value === current,
      source: 'settings',
      when,
      run: () => setChoice(ctx, s, o.value),
    }));
  }

  // 'open' is the catalog's default: list it, open Settings scrolled to it.
  return [{
    id: `settings.open:${s.id}`,
    title: `${s.label}…`,
    category: 'Settings',
    hint: `${pane.label} › ${s.section}`,
    keywords,
    icon: Settings2,
    focusKey: s.id,
    source: 'settings',
    run: () => ctx.openSettings(s.pane, s.id),
  }];
}

/** Next or previous preset of a font-size list, clamped at the ends. */
export function stepPreset(presets: readonly { value: string }[], current: number, dir: 1 | -1): number {
  const values = presets.map((p) => Number(p.value));
  if (dir > 0) return values.find((v) => v > current) ?? values[values.length - 1];
  return [...values].reverse().find((v) => v < current) ?? values[0];
}

function fontCommands(ctx: CommandContext): Command[] {
  const config = ctx.config ?? DEFAULT_CONFIG;
  const code = config.codeFontSize ?? DEFAULT_CODE_FONT_PX;
  const ui = config.uiFontSize ?? DEFAULT_UI_FONT_PX;
  const step = (dir: 1 | -1) => () => ctx.updateConfig({
    codeFontSize: stepPreset(CODE_FONT_PRESETS, code, dir),
    uiFontSize: stepPreset(UI_FONT_PRESETS, ui, dir),
  });
  const keywords = 'font size text zoom typography';
  return [
    { id: 'font:bigger', title: 'Bigger text', category: 'View', keywords, icon: AArrowUp, hint: `${code}px / ${ui}px`, source: 'settings', keepOpen: true, run: step(1) },
    { id: 'font:smaller', title: 'Smaller text', category: 'View', keywords, icon: AArrowDown, hint: `${code}px / ${ui}px`, source: 'settings', keepOpen: true, run: step(-1) },
    {
      id: 'font:reset',
      title: 'Reset text size',
      category: 'View',
      keywords,
      icon: Type,
      source: 'settings',
      when: code !== DEFAULT_CODE_FONT_PX || ui !== DEFAULT_UI_FONT_PX,
      run: () => ctx.updateConfig({ codeFontSize: DEFAULT_CODE_FONT_PX, uiFontSize: DEFAULT_UI_FONT_PX }),
    },
  ];
}

/**
 * Every settings pane ("Open Notifications settings") and every catalog
 * setting, as the catalog's `palette` field says: 'toggle' flips in place,
 * a listed choice sets in place, everything else opens its pane at the row.
 */
export function settingsSource(ctx: CommandContext): Command[] {
  const panes: Command[] = PANES.map((p) => ({
    id: `settings.pane:${p.id}`,
    title: `Open ${p.label} settings`,
    category: 'Settings',
    keywords: `settings preferences ${p.keywords.join(' ')}`,
    icon: p.icon,
    source: 'settings',
    run: () => ctx.openSettings(p.id),
  }));
  // Plan 007: the cross-pane Modified view. Export / Import Settings reach the
  // palette through the app menu source.
  const modifiedCount = modifiedSettings(ctx.config ?? DEFAULT_CONFIG).length;
  panes.push({
    id: 'settings.ux:show-modified',
    title: 'Show modified settings',
    category: 'Settings',
    keywords: 'settings preferences modified changed customized non-default defaults reset',
    hint: `${modifiedCount} changed`,
    icon: ListChecks,
    source: 'settings',
    when: modifiedCount > 0,
    run: () => ctx.openSettings('modified'),
  });
  const rows = SETTINGS
    .filter((s) => !OWNED_ELSEWHERE.test(s.id) && s.palette !== 'none')
    .flatMap((s) => settingCommands(ctx, s));
  return [...panes, ...fontCommands(ctx), ...rows];
}
